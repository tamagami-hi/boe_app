# Implementation Log

This log records the implementation and verification work performed after the complexity audit decisions were approved. It is intentionally separate from the architectural audit so the work can be resumed or reviewed without reconstructing the entire repository history.

## 2026-08-27 — Work resumed

- Confirmed the approved constraints: SIP/AutoPay remain supported; PhonePe owns debit/retry with `autoDebit=true` and `STANDARD`; durable users and financial history must be preserved; legacy compliance tables are removable only with forward migrations and preservation guards; Redis remains; development and production remain isolated; monitoring stays outside the core application boundary.
- Parallel implementation slices started:
  - Email OTP terminology/schema and legacy-table preservation migration.
  - Deployment, PhonePe, Redis, and monitoring-boundary alignment.
  - Audit documentation update with repository evidence.
- No source change is accepted until its diff is reviewed and the relevant checks pass.

## Verification policy

- Never drop a table or data path without checking foreign keys, row-preservation requirements, and statutory-retention risk.
- Keep one durable `users` identity for verified users and financial records.
- Keep PhonePe request semantics in the provider integration; the SIP worker only schedules, orchestrates, and reconciles.
- Keep Redis only for its measured application responsibilities; do not make it a source of financial truth.
- Record unresolved runtime/deployment observations as explicit `Needs runtime verification` items rather than treating static evidence as proof.

## Change entries

### 2026-08-27 — Accepted constraints reconciled in audit docs

- Updated `CODEBASE_COMPLEXITY_SIMPLIFICATION_AUDIT_2026-08-26.md`,
  `DATABASE_AND_SOURCES_OF_TRUTH.md`, `FILE_DISPOSITION_AND_ROADMAP.md`,
  `WORKFLOW_AND_EXECUTION_TRACES.md`, and `IMPLEMENTATION_CHANGELOG.md` with
  the accepted SIP/AutoPay, durable-user, legacy-table, Redis, dev/prod, and
  monitoring boundaries.
- Recorded exact PhonePe evidence: `phonePeRecurringGateway.ts` emits and
  validates `autoDebit=true` and `redemptionRetryStrategy="STANDARD"`; the
  collection worker sends Notify Redemption and reconciles status, with no
  Execute Redemption call found.
- Recorded that Redis is a shared read cache with PostgreSQL fallback, not the
  session/queue/lock/rate-limit/worker-coordination system, and that the
  historical concurrency cause is not statically proven.
- Recorded that `monitor_service` is tracked in this repository today, while
  the target architecture requires independent monitoring ownership.
- Marked migrations 040–042 and source renames as implementation-in-progress;
  deployment row counts, FK inventory, retention checks, and preservation
  verification remain required before their schema cleanup is called complete.

Entries will be appended after each implementation slice is reviewed and tested.

### 2026-08-27 — Email verification populated-upgrade integrity fixes

- Added the populated-upgrade regression coverage in
  `backend_controller/test/integration/emailVerificationMigration.integration.test.ts`.
- The backfill now selects the latest approved historical Email OTP record when a
  later rejected record exists, preserving the durable verified-user state.
- The preservation guard counts distinct approved users rather than historical
  approval rows, so repeated OTP approvals for one user cannot abort a valid
  upgrade.
- The populated-upgrade test now applies migration 042 and proves that the
  durable user and a linked SIP plan survive while `kyc_cases` is removed.
- Email verification audit events now record the incremented durable `users.version`
  instead of a hard-coded entity version.
- Verification: the focused migration and Email Verification integration tests pass
  11/11. The focused integration command still reports the repository-wide coverage
  threshold failure because it intentionally runs only two integration files; the
  full integration suite remains the coverage acceptance command.

### 2026-08-27 — Email Verification and deployment slice review

- Migrated Email OTP state onto `users.email_verification_state`,
  `users.email_verification_started_at`, `users.email_verified_at`, and
  `users.email_verification_expires_at` with `email_verification_codes` owned by
  the durable user ID.
- Renamed active backend routes, repositories, domain commands, frontend screens,
  services, and navigation from KYC to Email Verification.
- Updated admin/client projections and eligibility to use `verified` and
  `pending_verification` states; removed active reads of `kyc_cases` and
  `risk_assessments`.
- Added forward migrations 040–042 with backfill and fail-closed legacy-table
  guards. The cleanup migration must still be run against each deployed database
  only after row/retention review.
- Renamed deployment configuration keys to `EMAIL_VERIFICATION_*` so compose,
  examples, and deploy validation match backend runtime configuration.
- Deployment commit `2033dbf` aligned dev/prod environment contracts, isolated
  PostgreSQL/Redis resources, and added runtime contract assertions.
- Verification: backend typecheck/lint/build/smoke checks, backend unit tests
  (666/666), frontend tests (903/903) and production build/bundle boot, complete
  integration suite (207/207), runtime deployment contracts, and deployment
  environment validation all pass.

### 2026-08-27 — Frontend money conversion consolidation

- Roadmap item: Stage 4 amount-conversion consolidation; monitoring stack was
  intentionally left untouched.
- Added `frontend_stack/packages/shared/src/money.js` as the canonical read-side
  paise-to-rupee conversion.
- Replaced local conversion copies in admin formatters/fund operations and the
  client fund, order, portfolio, statement, and transaction adapters. Write-side
  parsers remain feature-local because their validation rules differ.
- Verification: targeted frontend tests passed 41/41; complete frontend tests
  passed 68 files / 903 tests; production build and bundle boot passed; and
  `git diff --check` passed.

### 2026-08-27 — Removed preview-only UI surfaces

- Roadmap item: REMOVE proven-unreachable UI-kit and static preview artifacts;
  monitoring stack intentionally left untouched.
- Removed `frontend_stack/packages/ui-kits` and `frontend_stack/preview` after
  verifying they were outside the workspace and had no production imports.
- Updated design-token directory scans and the audit/changelog records. Git
  history retains the deleted reference material if it is ever needed for
  historical review.
- Verification: full frontend tests passed (68 files / 903 tests), production
  build and bundle boot passed after the removal, and `git diff --check` passed.

### 2026-08-27 — PhonePe Standard Checkout AutoPay contract and rejection recovery

- Re-verified the active adapter against PhonePe's product-specific Standard
  Checkout AutoPay documentation. The canonical outbound contract remains
  `/checkout/v2/subscriptions/notify`,
  `/checkout/v2/order/{merchantOrderId}/status`,
  `/checkout/v2/subscriptions/{merchantSubscriptionId}/status`, and
  `/checkout/v2/subscriptions/{merchantSubscriptionId}/cancel`, with
  `paymentFlow.type=SUBSCRIPTION_CHECKOUT_REDEMPTION`.
- Did not replace those paths with the generic `/subscriptions/v2` API family.
  PhonePe's generic AutoPay index and public Postman collection document that
  separate family, but the repository creates mandates through the Standard
  Checkout `SUBSCRIPTION_CHECKOUT_SETUP` flow. Mixing the two API families
  would break correlation with the active setup contract.
- Preserved `autoDebit=true` and `redemptionRetryStrategy=STANDARD`. PhonePe's
  Standard Checkout documentation states that Execute is unnecessary when
  AutoDebit is true and that PhonePe owns retries for the STANDARD strategy.
- Strengthened the existing gateway contract test with exact Standard Checkout
  setup-status, subscription-status, redemption-status, and cancellation paths.
- Added a payment-critical worker regression test proving that a definitive
  non-retryable Notify rejection previously left the collection in
  `dispatching` and its canonical payment/order open indefinitely. The worker
  now atomically marks the collection failed and applies the canonical failed
  payment outcome only for `GatewayRejectedError`.
- Ambiguous failures such as timeouts, throttling, malformed responses, and 5xx
  responses remain in reconciliation instead of being converted into false
  failures. A persistent provider 404 after an ambiguous Notify has no proven
  safe automatic resend contract and remains `Needs runtime/vendor verification`.
- Primary sources:
  - https://developer.phonepe.com/payment-gateway/autopay/standard-checkout/redemption-notify
  - https://developer.phonepe.com/payment-gateway/autopay/standard-checkout/notification-status
  - https://developer.phonepe.com/payment-gateway/autopay/standard-checkout/subscription-status-2
  - https://developer.phonepe.com/payment-gateway/autopay/standard-checkout/subscription-cancel
- TDD evidence: the focused worker test failed 1/6 before the implementation
  because no failed-state transition occurred, then the gateway and worker
  tests passed 12/12 after the minimal fix.

### 2026-08-27 — Contract and destructive-deployment safety fixes

- Regenerated the frontend contract-drift baseline so the four canonical Email
  Verification routes replace the removed KYC routes. The full contracts check
  now passes 95/95 tests and all generation, lint, export, and drift gates.
- Migration 042 is assigned to schema release family `0.11.9`, the first release
  after the existing `v0.11.8` tag that can contain migrations 040–042.
- Deployment refuses to run pending migration 042 under an older release
  identity, refuses `--skip-db-backup`, stops database consumers before taking
  the mandatory snapshot, and blocks image-only rollback after the destructive
  migration.
- A fresh database with no applied migration history is not misclassified as a
  destructive upgrade merely because migration 042 appears in its pending list.
- A populated upgrade with no recorded current release fails closed because it
  cannot produce a version-addressable backup and rollback target safely.
- Manual restore verification now rejects a snapshot containing migration 042
  when the rollback target belongs to the pre-042 schema family.

### 2026-08-27 — Destructive migration deployment safety gates

- Added critical deployment regression coverage in
  `release_manager/tests/database_backup.test.sh` for the migration-042
  rollback boundary, mandatory backups, migration-status detection, and
  stopping database consumers before a destructive migration backup.
- `_boe_lib.sh` assigns migration 042 to release schema family `0.11.9` and
  detects an exact pending `042_remove_legacy_compliance_tables.sql` marker
  from the incoming migrate image. The existing `v0.11.8` tag predates these
  migrations, and deployment fails closed if migration 042 is pending under an
  older release identity.
- `_boe_deploy.sh` loads the incoming image, starts only PostgreSQL, inspects
  migration status, rejects `--skip-db-backup` when migration 042 is pending,
  stops all Compose consumers except PostgreSQL, and then takes a mandatory
  pre-deploy snapshot before starting the migration-bearing stack.
- A failed deployment that has crossed the destructive boundary no longer
  attempts an image-only rollback; it leaves consumers stopped and requires
  the explicit database-restore rollback workflow. Consumer-stop failure is
  fail-closed rather than ignored.
- TDD evidence: the new deployment checks failed before the guards existed
  (`boe_deploy_requires_database_restore: command not found`), then
  `bash release_manager/tests/database_backup.test.sh` passed. All
  `release_manager/tests/*.test.sh` scripts passed, and `bash -n` plus
  `git diff --check` passed for the changed deployment scripts and test.
- The actual VPS migration status, deployed schema marker, and live consumer
  inventory remain **Needs runtime verification**.

### 2026-08-27 — Remaining work and payment-test readiness

- Added `REMAINING_WORK_AND_PAYMENT_TEST_READINESS.md` to reconcile the remaining
  audit roadmap into release blockers, payment UAT, product gaps, consolidation,
  runtime verification, and documentation cleanup.
- Recommended a controlled development/UAT VPS deployment and low-value PhonePe
  payment testing after creating a `0.11.9` or newer release and completing the
  migration, backup, isolation, webhook, and worker preflight checks.
- Production promotion remains gated on successful one-time payment, SIP/AutoPay,
  idempotency, reconciliation, cancellation, migration-preservation, and rollback
  evidence from development/UAT.

### 2026-08-27 — Debuggable development APK and physical PhonePe diagnosis

- Changed `emu/boe_update.sh` so development/local APKs use the Android debug
  build type by default while production continues to require a signed,
  minified, non-debuggable release build.
- Added the explicit `boeSignDebugWithRelease` Gradle property in
  `frontend_stack/app/android/app/build.gradle`. A development debug APK may use
  the configured release certificate so it updates the installed test app
  without clearing its data; this does not make the production build debuggable.
- Built and installed `com.beonedge.app.dev` version code 1109 on the connected
  OnePlus CPH2585. Android reported the installed package as `DEBUGGABLE`; APK
  signature verification reported the configured BeOnEdge release certificate.
- Reproduced one-time PhonePe checkout on the physical device. The native
  `com.phonepe.intent.sdk.ui.b2bPg.B2bPgActivity` opened, proving that the
  Capacitor bridge reached the PhonePe SDK. PhonePe's embedded checkout then
  displayed `Sorry, we couldn’t process your request.`
- The backend had already created a provider order and SDK token. PhonePe sent a
  signature-valid `payment.checkout.order.failed` event. Its immediate status
  lookup still returned `PENDING`, so the canonical attempt correctly remained
  pending rather than trusting the webhook label alone. The healthy payment
  reconciliation worker later observed `FAILED` and atomically converged the
  attempt, payment, and investment order to `failed`, `failed`, and
  `payment_failed` with `PROVIDER_DECLINED`.
- No application-side crash, stuck worker, unsigned callback, missing SDK token,
  or reconciliation defect was observed. The remaining cause is inside the
  PhonePe rejection boundary and requires checking the merchant's selected
  environment entitlement and registration for the exact application ID and
  signing certificate in the PhonePe merchant configuration.
- `ionic-capacitor-phonepe-pg@3.0.5` declares a Capacitor `^4.0.0` peer while the
  application uses Capacitor `8.3.4`; `npm ls` reports this relationship as
  invalid. The tested checkout did open, but full Capacitor 8 / Android 16
  lifecycle compatibility remains a release risk requiring vendor confirmation
  or replacement with a supported plugin.
- Review found and corrected two build-policy defects: development now fails
  closed without the stable signing configuration instead of silently changing
  certificate identity, and dependency inspection now follows the actual Android
  build type rather than the signing certificate label. Variant-sensitive files
  produced by Capacitor sync were excluded from the committed change.
- Security review also decoupled APK debuggability from PhonePe SDK logging.
  `phonePeMobileCheckout.js` now initializes the provider with
  `enableLogging=false` in every build. Debug APKs remain attachable through
  Android tooling, while provider intent/token material is not automatically
  emitted merely because the package is debuggable.
- Focused APK policy tests passed 14/14 and hermetic-branding tests passed 13/13;
  both development debug and production release APKs built successfully. Their
  sidecars respectively prove `debuggable=true` and `debuggable=false`. Shell
  parsing and `git diff --check` passed. Diagnostic captures are local, ignored,
  mode `0600`, bounded, and credential-redacted by `emu/boe_logcat.sh`.

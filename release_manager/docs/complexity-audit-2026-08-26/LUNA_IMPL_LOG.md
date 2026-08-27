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

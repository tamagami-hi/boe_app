# Completion plan — maturity and financial corrections

Written 2026-09-09 while resuming the Feature E handoff. Root README applies.

## Product requirements

An authorized administrator marks a client/fund position mature and settles the pending maturity
once, either by withdrawing a positive amount up to its locked current value or by reinvesting its
entire gain or loss into principal. Zero withdrawal creates no entries and is rejected. Zero-gain
reinvestment is rejected. A withdrawal creates its payout record and ledger entry atomically.
Payout completion records a transfer reference; correcting a ledger entry does not imply returned
cash or change the payout state. Settlement always derives amounts from the current locked position.

## Architecture and system design

Keep the existing append-only ledger, transaction unit of work, audited idempotent admin mutation
wrapper, permission and CSRF checks. Use the shared advisory position lock before user and maturity
row locks. Split enum additions into migration 050 and enum-dependent constraints/tables into 051.
Expose strict contracts and client/admin reads for both new ledger types. Keep settlement financial
calculation, repository writes, and HTTP mapping separately focused.

## Technical corrections

Reversal first reads the immutable entry identity without a row lock, then takes position, user,
and entry locks in that order. It reads actual visible ledger totals and unreversed contribution
count without the growth repository's contribution eligibility filter. Before appending a reversal,
reject negative resulting principal/value and removal of the last contribution when a residual
position remains. Return actual derived totals, including when all entries have been reversed.

For migration 051, bind payout maturity provenance to user and fund, require a settled maturity's
ledger reference, and require paid payout transfer evidence. Validate real calendar dates and money
bounds at the HTTP boundary. Published AUM remains based on its separate snapshots.

## Task list and validation

1. Finish maturity repository, mark/settle operations, and payout state updates.
2. Complete contracts, routes, application wiring, and admin actions/history.
3. Add minimal financial regression tests before implementing reversal protection; cover negative
   balances, last-contribution residuals, and shared lock order.
4. Validate withdrawal/reinvestment arithmetic, duplicate settlement prevention, authorization,
   statement totals, and payout independence from reversal.
5. Run relevant static checks, unit coverage, integration migrations/constraints where a disposable
   PostgreSQL runtime is available, and review the final financial changes.

## Initial security review findings

The unfinished reversal path can make principal/value negative after settlement and can hide
residual values by using a contribution-filtered basis. It also locks users before positions while
recorded contributions use the opposite order, creating a deadlock risk. These are blocking fixes.
The initial migration permits mismatched payout/maturity funds, settled maturities without ledger
references, and paid payouts without transfer references. Tighten these before completion.

Static review also corrected a handoff assumption: a full withdrawal does not reverse contributions,
so the growth query still returns its zero-valued position; callers must handle it explicitly.

## Final implementation and validation — 2026-09-09

Completed the maturity repository and separate mark, withdrawal, reinvestment and payout-update
operations, six admin endpoints, shared API descriptors/generated artifacts, admin settlement and
payout panels, and client activity/statement reporting. Existing Features A–D were preserved.
Fixed the interrupted NotificationsTable declaration. Tightened migration 051 provenance and
state constraints; maturity audit versions start at 1. Payment contributions share the position
lock, and reversals validate both current totals and historical daily minima.

Validation results:

- Backend `npm run check`: passed, including typecheck, lint, 880 tests, coverage, build, and source
  and compiled-entrypoint smoke checks. Configured unit coverage: 83.51% lines/statements,
  83.33% branches, 89.8% functions. This configured unit scope excludes database-bound domain,
  repository and route files.
- Separate critical maturity/payout domain coverage: 98.85% lines/statements, 97.33% branches,
  100% functions across 37 focused cases.
- Disposable PostgreSQL targeted integration: maturity 11, client growth 14, payment settlement 25
  tests passed (50 total across the final targeted runs). Migrations 048–051 were exercised.
  Targeted integration uses `--coverage.enabled false`; whole-project coverage is not meaningful
  for an intentionally filtered test run.
- Contracts: typecheck, lint, 95 tests, OpenAPI lint and frontend contract-bypass check passed.
  Regenerated OpenAPI JSON/types and frontend operation client were byte-for-byte unchanged.
- Frontend: typecheck, lint, 212 tests, admin and client production builds and bundle boot checks
  passed.
- Chromium browser smoke with mocked API responses: investor selection, maturity marking,
  zero/overdraw validation, confirmed withdrawal, payout completion from version 0, refreshed
  balances and history; no page errors. Backend behavior was independently exercised on PostgreSQL.
- Code/security review fixed final/historical reversal underflow and lock-order risks. No remaining
  HIGH/CRITICAL finding in the reviewed settlement flow. `git diff --check` passed.

The broad integration run is not green. Its run had 73 failures: one new reinvestment fixture omitted
required growth provenance and was corrected to use the real growth endpoint; all maturity cases
subsequently passed. The other 72 failures belong to existing admin AUM, fund catalogue, mandate,
and client email-verification suites. The admin fixtures issue client-native bearer sessions for
admin routes; current admin authentication requires its own audience/channel. The email tests use
removed resend/status response expectations. These tests and the corresponding authentication and
email routes already have that mismatch at HEAD; this completion did not change their behavior or
weaken their security checks. Full integration coverage therefore remains unverified.

No commit, deployment, shared-database migration or seed operation was performed. Before deploying,
apply pending migrations in numeric order and run the backend seed for permission grants. Payout
status records an operator-confirmed external transfer; the app does not initiate a bank payout.

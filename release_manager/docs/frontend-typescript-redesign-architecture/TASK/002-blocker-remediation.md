# Task 002 — Blocker remediation

**Log entries:** [002](../LOGS/implementation_log.md), [003](../LOGS/implementation_log.md),
[004](../LOGS/implementation_log.md), [005](../LOGS/implementation_log.md)
**Decisions:** [D-001](../LOGS/risk_and_decision.md#d-001) ·
[D-002](../LOGS/risk_and_decision.md#d-002) · [D-003](../LOGS/risk_and_decision.md#d-003) ·
[D-004](../LOGS/risk_and_decision.md#d-004) · [D-005](../LOGS/risk_and_decision.md#d-005)

## What was asked

Fix the seven blockers surfaced by the architecture investigation, before starting the redesign.

## Outcome

| Blocker | Result |
|---|---|
| B1 — migration 043 untracked and unapplied | **Verified, deferred by decision.** Code unchanged |
| B2 — contract coverage 15 of ~90 endpoints | **Structural half done**, bulk resequenced to per-phase |
| B3 — AutoPay has no browser path | **Open** — needs a product answer, blocks Phase 8 only |
| B4 — drift checker hardcoded to `frontend_stack` | **Fixed** |
| B5 — new frontend origin not in `WEB_ORIGIN_ALLOWLIST` | **Deferred to Phase 1** — needs the port to exist |
| B6 — no CI job for the new frontend | **Deferred to Phase 1** — `npm ci` fails until the directory exists |
| B7 — `.env.legacy-backup` holding dead Razorpay keys | **Deleted** |

## What I actually did

### B1 — verified rather than changed

Read migration 043 and traced what it depends on. It is correct and needs no registration
anywhere:

- 035's `payment_attempts_checkout_channel_check` already permits the `hosted_redirect`
  **value**, so only the dispatch gate needed widening. 043 drops
  `payment_attempts_sdk_dispatch_channel_check` and adds
  `payment_attempts_dispatch_channel_check` including `hosted_redirect`.
- `src/scripts/migrate.ts::loadMigrationFiles` discovers migrations by **directory scan in
  filename order**, checksums them, and tracks them in `schema_migrations`. No manifest to update.
- The destructive-migration gate in `_boe_deploy.sh` is hardcoded to **042 by name**, and 043 only
  relaxes a constraint, so no tooling registration either.
- `paymentsRepository.ts:273` and `:335` are the two writes that require it —
  `markAttemptDispatchStarted` and `markAttemptDispatched`, both filtering
  `checkout_channel = 'hosted_redirect'`.

Then confirmed the deployed reality read-only on the VPS, which **corrected three claims** the
audit had taken from documentation:

- **042 *is* applied on dev.** 33 migrations, latest `042_remove_legacy_compliance_tables`, and
  `kyc_cases`, `risk_assessments` and `legacy_investment_reviews` all absent. The prior docs said
  042 was unapplied everywhere.
- **043 is genuinely unapplied** — `payment_attempts` still carries the 035 constraint. So this
  was a real blocker, not a theoretical one.
- **Only four worker containers run** — `boe-dev-{sips,payments,email,collections}-worker`. There
  is no mandate-reconciliation worker process, confirming the audit finding that it has no
  entrypoint, no compose service and no health check.

Also learned that migration ordering is **structural**: the compose `migrate` service runs
`npm run migrate` from the backend image with `depends_on: postgres service_healthy`, and the
backend depends on its completion. So "migration before code" is guaranteed within a deploy — my
doc had framed it as a manual ordering concern, which was wrong.

**Maintainer decision (D-003):** verify 043 with the new frontend at new-stack deploy time, with a
schema backup. Does not gate Phase 1; remains a hard prerequisite for Phase 7.

### B2 — the structural half

Measured the real cost before committing to the original plan: `admin-fund-aum.ts` is 782 lines for
8 operations, so ~75 remaining operations is ~7,000 lines of descriptors written before any screen
exists. Resequenced to per-phase (D-001), then landed only what makes those descriptors writable
at all.

**The find that justified doing this now:** `OperationSecurityPolicy` only permitted `native-bearer`
with `idempotency: "naturally-idempotent"`. It **could not express a client write requiring an
idempotency key** — which is `POST /v1/client/orders`, `POST /v1/client/orders/:orderId/pay`, and
all four AutoPay operations. The entire client write surface was uncontractable and the original
audit missed it. Added a `native-bearer` variant permitting
`"none" | "naturally-idempotent" | "required-key"`.

Also: two missing error codes, and `PageMeta` without which no list endpoint is describable.

Catalogue parity is now provable — I diffed the backend `ErrorCode` union against the package:
24 codes, identical sets, and the two new statuses match `ERROR_HTTP_STATUS` exactly.

`errors.test.ts` needed updating. It is a deliberate mirror of the catalogue, asserting exact
contents and order, so adding codes to the source without the mirror is a type error. Per
`README.md` §6 this is the legitimate case — expected behaviour intentionally changed. It is not a
test weakened to pass.

### B4 — the fix that mattered more than it looked

The obvious problem was the hardcoded `frontendRoot`. The subtle one was the failure mode: a naive
fix that simply skipped a missing root would make the checker report **"0 paths, no drift"** — a
false green on a contract gate, at exactly the moment the legacy tree is deleted. So all-roots-
missing now throws with an actionable message.

Verified three ways: default behaviour byte-identical (74 paths, 57 request paths, 60 gaps,
exit 0), missing-root case fails loudly, substituted root reports drift in both directions.

### B7 — deleted

Confirmed untracked, gitignored, referenced only by the architecture docs, and that every
distinctive key is unreferenced under `backend_controller/src`. The file was entirely
pre-TypeScript: `DATA_STORE`, `JSON_DB_PATH`, `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`,
`ALLOW_DEV_AUTH`, `PROVIDER_MODE=razorpay`, a Razorpay key triple, and plaintext seed passwords.
Values were never echoed.

## What the next developer needs to know

1. **043 gates Phase 7, not earlier.** Do not write hosted-checkout code expecting it to work
   against the current dev database.
2. **The drift gate now watches `frontend_stack_ts/src`.** The first uncontracted path the new
   frontend calls will fail CI. That is intended — add the descriptor, do not add to the baseline.
3. **`generate:check` will fail until the regenerated `generated/openapi-v1.{json,d.ts}` are
   committed.** The diff is exactly the two new error codes. Not a defect.
4. **zod is pinned to 4.4.3 in both `packages/contracts` and the new frontend.** Bump them together
   or type inference breaks (D-007).
5. **Two findings were deliberately left unfixed**: `Notifications.jsx:89` handing a server-supplied
   `deepLink` straight to `navigate()`, and `/app/mandates/:id` being unreachable after the creating
   session. Both live in `frontend_stack`, which must stay untouched, and both are already resolved
   in the target design — `resolveDestination` at all four call sites, and a new `/sips` list screen.

## Verification

TESTED on this machine: `tsc --noEmit` on the backend dirty tree; all seven `packages/contracts`
check steps except `generate:check`; the drift checker in three configurations; key-reference greps
for B7.

VPS, read-only: container health, deployed version, applied migrations, the live constraint on
`payment_attempts`, and the worker set.

**Not verified:** no payment was executed, no deploy was performed, and no device was involved.

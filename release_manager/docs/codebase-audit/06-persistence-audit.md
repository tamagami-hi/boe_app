# 06 — Persistence audit

**Nothing in this document was changed.** No migration was written, no table dropped, no column
removed, no enum value retired.

That is deliberate and follows the audit brief:

> Do not drop database structures merely because current application code appears not to use them
> unless historical, migration, rollback, reporting, or compatibility needs are ruled out.

None of those can be ruled out from the working tree. Every item below needs a reviewed migration
plus a judgement about historical rows, and both are the maintainer's. Everything here is
**STATIC** — schema text and source read only. §6 gives the read-only SQL that would turn each
suspicion into a fact.

Migrations present: `009` … `047` (39 files). `001`–`008` do not exist; the canonical baseline
starts at `009_canonical_onboarding.sql`.

## 1. Dead tables

Verified by grepping the table name across `backend_controller/src` excluding `*.test.ts` and
`db/types.ts` — and, critically, **including** raw `sql\`…\`` templates, because
`fund_stock_disclosures` is reachable *only* through raw SQL and a Kysely-type-only audit would
have wrongly condemned it.

| Table | Evidence | Class |
| ----- | -------- | ----- |
| `rate_limit_windows` | Zero references outside `db/types.ts` and the `Database` map. Rate limiting is entirely in-process: `http/rateLimit.ts` holds a `Map` swept in memory | **DEAD TABLE** |
| `finance_policy_versions` | Zero references outside `db/types.ts` | **DEAD TABLE** |
| `legal_holds` | Only the type alias in `db/repositories.ts`, which this audit removed. No query anywhere | **DEAD TABLE** |
| `email_provider_events` | A repository and route exist, but the route is never registered in either deployed stack (see [05](05-configuration-audit.md) §5) | **DEAD IN DEPLOYMENT** |

A consequence of the first row worth stating on its own: because rate limiting is per-process and
in-memory, **limits do not survive a restart and are not shared between the backend replicas**.
The persisted design was abandoned; the table and its Kysely type are its residue. The real
brute-force control on login is the nginx `boe_auth` zone — which is exactly why the gap in
[07](07-tooling-deployment-docs.md) §1 mattered.

## 2. Dead columns

### `user_credentials` — confirmed, and knowingly retained

`010_canonical_identity.sql` declares `failed_attempt_count` (NOT NULL DEFAULT 0),
`failed_attempt_window_started_at`, and `locked_until`, plus two CHECK constraints tying the first
two together.

Every non-test reference to `user_credentials` is in `credentialRepository.ts` (existence probe and
an insert of `user_id` + `password_hash`), `userRepository.ts` (selects `password_hash`) and
`scripts/seedAuth.ts`. **None of the three lockout columns is read or written by any code path.**

`026_login_events.sql` already says so in its own header: *"No lockout enforcement.
`user_credentials.locked_until` / `failed_attempt_count` remain unused by code."* The migration
exists to make lockout *decidable* by recording attempt history — a documented deferral, not an
oversight.

D-051 removed `locked_until` from the Kysely type while leaving the columns, and deliberately left
the other two in the type. Confirmed unchanged. The asymmetry stands: `db/types.ts`
under-describes this table by one column, and no schema-drift test would notice, because nothing
compares `db/types.ts` to `db/migrations/**`.

Class: **LATENT-RETAINED (documented)** for the columns; **STALE** for the two type entries that
describe dead columns. Left alone — they are one CHECK-coupled unit and dropping them is one
reviewed migration.

### `provider_events` — confirmed dead, plus one item D-050 did not mention

`018_canonical_payments.sql` declares the state enum with four values and the lease/backoff
columns `attempt_count`, `available_at`, `locked_at`, `locked_by`, `last_error_code`, a coherence
CHECK on the lease pair, and a claim index on `(available_at, created_at, id)`.

`providerEventInboxRepository.ts` is the sole reader and writer, and after D-050 removed the drain
it exposes only `insertVerified`, `attachPayment` and `markProcessed`. So:

| Item | Status |
| ---- | ------ |
| States `processing`, `dead_lettered` | No code path can produce them. **DEAD enum values** |
| `attempt_count`, `available_at`, `last_error_code` | Never written, never read. **DEAD** |
| `locked_at`, `locked_by` | Written only as the constant `null` by `markProcessed`, never read. **DEAD**; the coherence CHECK is trivially always true |
| The claim index on `(available_at, created_at, id)` | **Serves no query. DEAD INDEX** — pure write amplification |
| `signature_valid` | Written only as the literal `true`. **Single-valued column** |

The repository's own header documents the states and lease columns. **The dead index is the one
item D-050's note does not mention** and is the only entry here with an ongoing cost.

Class: **LATENT-RETAINED (documented)**, D-050 having deliberately kept the schema shaped for a
drain's return — with the index as an unrecorded exception worth raising.

## 3. Columns written but never consumed

- **`refund_operations.last_status_checked_at`** — *was* written and read only for display. This
  audit made it load-bearing: `lockDueRefunds` now filters on it, which is what bounds the refund
  poll. See [02](02-lifecycle-and-state-machines.md) F-002. **Now ACTIVE.**
- **`refund_operations.attempt_count`** — incremented by `markProviderPending`, compared to
  nothing. The refund machine has no failure cap. Reported as F-005.
- **`mandate_collection_attempts.retry_strategy`** — a `text` column with no reader found.
  **UNCERTAIN**, low confidence, worth a targeted grep.
- **`erased_at`** (`email_deliveries`, `email_provider_events`, `provider_events`) and
  **`pii_tombstoned_at`** (`applications`, `users`) — GDPR-shaped columns with no writer found.
  **UNCERTAIN → likely DEAD.** This one is a *compliance* gap rather than dead code: the schema
  encodes an erasure capability that nothing performs.

## 4. The systemic finding: there is no retention

`grep -rn "deleteFrom\|purge\|prune\|retention"` across `backend_controller/src`, excluding tests,
returns only an `expires_at` **comparison** inside a reconciliation claim and two field names.

**There is no `deleteFrom` and no scheduled pruning anywhere in the backend.**

Every one of these grows without bound, and several encode a lifecycle nothing advances:

| Table | Lifecycle encoded | What acts on it |
| ----- | ----------------- | --------------- |
| `idempotency_records` | `expires_at`, sized by `IDEMPOTENCY_TTL_MS` | Honoured on read; **never swept** |
| `provider_events` | lease columns, `erased_at` | Nothing |
| `email_provider_events` | `expires_at`, `erased_at` | Nothing (and the route is unmounted) |
| `rate_limit_windows` | `expires_at` | Nothing — dead table |
| `audit_events`, `auth_login_events`, `notifications`, `worker_heartbeats`, `outbox_events` | none | Append-only, forever |

Note the loop this closes: `PROVIDER_EVENT_TTL_MS` is the one TTL that actually gets written into
a row, and it is written by `routes/providerEventRoutes.ts` — the route that is **not mounted in
either deployed stack**. So the only TTL the system computes is computed by dead-in-deployment code.

Class: **BROKEN-STUCK** at the design level — the schema describes a data lifecycle (`expires_at`,
`erased_at`, `pii_tombstoned_at`, lease columns) that no code advances or reaps. Correctness is
unaffected today; storage growth and compliance posture are not.

## 5. Seeds — active, and one defect already fixed

`db/seedContent.ts` → consumed by `db/seedCatalog.ts`; `buildSeedStatements()` → called by
`scripts/seed.ts` and `scripts/seedAuth.ts`; `SEED_ROLE_PERMISSIONS` → consumed by `seedAuth.ts`
for the `superadmin` role. All wired to real npm scripts, and `seedAuth.ts` is a real CLI
entrypoint gated by `SEED_AUTH_ENABLED`, `SEED_AUTH_ALLOW_PRODUCTION` and `SEED_AUTH_OVERWRITE`.

Verdict **ACTIVE**. The one defect in this area was the `SEED_ADMIN_*` name mismatch, fixed in
[05](05-configuration-audit.md) §3.

## 6. Read-only SQL to convert these suspicions into facts

```sql
-- do the dead tables hold anything?
select count(*) from rate_limit_windows;
select count(*) from finance_policy_versions;
select count(*) from legal_holds;
select count(*) from email_provider_events;

-- have the unproducible enum values ever been produced?
select count(*) from provider_events where state in ('processing','dead_lettered');

-- has lockout ever been recorded?
select count(*) from user_credentials
where failed_attempt_count > 0 or locked_until is not null;

-- has the claim index on provider_events ever been scanned?
select relname, indexrelname, idx_scan
from pg_stat_user_indexes where relname = 'provider_events';

-- are the erasure columns ever populated?
select count(*) from email_deliveries where erased_at is not null;
select count(*) from users where pii_tombstoned_at is not null;

-- unbounded growth, in order of size
select relname, n_live_tup from pg_stat_user_tables order by n_live_tup desc limit 15;
```

**UNVERIFIED** — run on the VPS with `ssh beonedge` and read-only access.

## 7. Recommended order if these are ever retired

Grouped by what one reviewed migration can safely carry.

1. **The `provider_events` claim index alone.** The only item with an ongoing write cost and no
   compatibility surface. Confirm `idx_scan = 0` first.
2. **The three dead tables** (`rate_limit_windows`, `finance_policy_versions`, `legal_holds`),
   after confirming they are empty. Drop the Kysely types in the same change.
3. **A retention worker**, before any `expires_at` column is dropped — reaping is the behaviour
   those columns were added for, and it is a feature, not a cleanup.
4. **The `user_credentials` lockout group**, and only as part of deciding whether lockout is
   implemented or abandoned. `026_login_events.sql` frames it as decidable; that decision is still
   open.
5. **The `provider_events` lease columns and unused states**, only if D-050's "the schema is still
   shaped for a drain's return" is explicitly withdrawn.

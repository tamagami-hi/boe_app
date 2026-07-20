# Handoff: Backend JS→TS Migration Complete + Later-Domain Schema (increment 1)

## Purpose And Stop Condition

This handoff is for the next engineering agent continuing the `backend_controller`
work. The **backend JS→TS migration is complete** (0 authored JavaScript, gated),
the **production server composition is wired**, and the **first increment of the
later-domain business schema** (compliance/catalog/platform) has landed. The next
task is **later-domain schema increment 2 (the money-movement core) + the Kysely
types for all later-domain tables**, then the repositories/routes that consume
them.

All work is on branch **`ts-migration/backend`** (open **PR #1** → `main`,
`tamagami-hi/boe_app`). Latest pushed commit at handoff time: **`461ed37`**.

Everything below is on that branch. Do not push to `main`. Keep the per-batch
gate + guard discipline described in "Working agreement".

## Where Things Stand

### Backend is fully TypeScript (BE-002 … BE-020)
- Authored backend JS/JSX: **0** (from 83 baseline). Permanent gate:
  `src/zero-legacy-js.guard.test.ts` (asserts 0 authored `.js/.jsx/.cjs/.mjs`
  under `src/`+`scripts/` and no legacy `#`-alias imports). The per-file
  `src/legacy-deletion.guard.test.ts` also keeps every deleted legacy file gone.
- Canonical first-slice covered end to end: public onboarding
  (`POST /v1/applications`, `verify-email`, `GET /v1/public/consent-documents`),
  native + web (cookie/CSRF) auth with ES256 + refresh/CSRF rotation, admin
  identity (queue/detail/review/decision/invite-resend/email-deliveries, RBAC +
  authenticated cursors + idempotency), SES/SNS outbox worker + signed
  `POST /v1/provider-events/aws-sns`, health/readiness.

### Production server composition (PROD-001)
- `src/runtime/composition.ts` `composeBackend(env)` builds pool/database/
  unit-of-work/crypto/access-token/breach-checker/certificate-fetcher/repos and
  returns `{ registerRoutes, checkReadiness, dispose }`; `server.ts` composes +
  registers all routes + closes the pool on graceful drain.
- `src/runtime/environment.ts` `parseServerConfig` loads the full deployment env
  (see updated `backend_controller/.env.example`). `src/email/certificateFetcher.ts`
  is an SSRF-hardened SNS cert fetcher.
- Both smokes (source + dist) now boot the **full composed server** via an
  ephemeral env injected by `scripts/smoke-entrypoint.ts`.
- **Still deferred:** the email delivery *worker* runs as a separate background
  entrypoint and needs a **concrete Amazon SES v2 sender adapter** (the worker
  command `dispatchDueDeliveries` and the `SesEmailSender` port already exist from
  BE-012). Not wired into the HTTP server on purpose.

### Later-domain schema increment 1 (BE-021.1)
Grounded in **spec 03 §4** (not speculative). Additive migrations on the `>= 009`
baseline, validated by `test/integration/laterDomainSchema.integration.test.ts`:
- `014_canonical_compliance.sql` (§4.1): investor_profiles, kyc_cases,
  kyc_documents, kyc_reviews, risk_assessments.
- `015_canonical_catalog.sql` (§4.2): funds, fund_versions,
  fund_disclosure_versions, fund_nav_prices, fund_positions, fund_aum_snapshots.
- `016_canonical_platform.sql` (§4.5): finance_policy_versions, marketing_leads,
  courses, membership_plans, app_config_versions, content_items.
- **No Kysely `Database` types or repositories for these yet** — deferred to
  increment 2 so types + repos land together (schema-first).

## What I Was About To Do Next (the actual next task)

Implement **later-domain schema increment 2** and its types, per **spec 03 §4.3
(investing/ownership) and §4.4 (payments/provider inbox)**. Then (separate batch)
the repositories/routes that consume the whole later domain.

### 1. Migrations (respect this dependency order — it is why they weren't in inc. 1)
Read spec 03 §4.3 (≈ lines 1044–1129) and §4.4 (≈ 1130–1180) and §2.1/§2.2 enums
before writing. Suggested files:
- `017_canonical_investing.sql`: create **mandates first** (spec §4.4, but §4.3
  `sip_plans` needs it), then `sip_plans`, `investment_orders`,
  `investment_executions`, `holdings`, `holding_lots`, `holding_lot_movements`,
  `redemption_requests`. Enums: `mandate_state`, `sip_state`, `order_state`,
  `order_type`, `execution_type`, `redemption_state`.
- `018_canonical_payments.sql`: `payments`, `payment_attempts`, `provider_events`,
  `notifications`. Enums: `payment_state`, `provider_event_state`.

**Known dependency gotchas (validated while planning inc. 1):**
- `payments.(order_id,user_id)` → `investment_orders(id,user_id)`: orders must
  exist before payments → payments migration comes **after** investing.
- `sip_plans` → `mandates` via composite `(mandate_id,user_id)`: mandates must be
  created before sip_plans (that is why mandates goes in `017`, not `018`).
- `redemption_requests.finance_policy_version` → `finance_policy_versions(version)`
  (already built in `016`, which is why policy shipped in increment 1).
- `investment_executions` reference orders; `holdings/holding_lots/
  holding_lot_movements` reference executions; ownership carried as composite FKs
  on `(…, user_id)` — mirror the `015` `fund_versions` composite-FK pattern.
- Money is **integer paise in bigint**; NAV/units/allocation are `numeric(24,8)`.
  Executions/holdings/movements are **append-only** (no update/delete of booked
  financial evidence — enforce via constraints + domain, per §4.3/§6).

### 2. Kysely types
Add all increment-1 **and** increment-2 tables to the `Database` interface in
`src/db/types.ts` (match the existing helpers: `Timestamp`, `Bytea`,
`Nullable`, `BigIntString`, `Json`, enum unions). Add `Row<>` exports in
`src/db/repositories.ts` as needed. `npm run typecheck` validates shape; real
correctness comes when repos query them.

### 3. Validation
Extend `laterDomainSchema.integration.test.ts` (or add a sibling) with a
money-core happy path (mandate → sip_plan → order → execution → holding/lot/
movement; order → payment → attempt) plus the key negative constraints
(cross-user composite FK rejection, single-active partial uniques, append-only).

### Scope decision the user is weighing (unanswered — confirm before building)
I asked the user to choose; they have **not** answered yet:
- **Option 1 — full spec:** build all of §4.3+§4.4 (~52 tables total).
- **Option 2 (my recommendation) — lean launch:** build only the money core
  (funds/orders/executions/payments/holdings/mandates) and defer
  courses/plans/content/marketing/fund_positions/fund_aum until needed (~38–42
  tables). Do **not** collapse financial tables into JSON to shrink the count.
- **Option 3 — pause schema**, wire repositories/routes on already-built domains.

**Start increment 2 only after the user picks an option.** The full production DB
is ~52 tables (23 first-slice already built + ~29 later-domain); this is normal
for a regulated investing app and is not the maintenance risk — collapsing
normalized financial tables would be.

## Also Outstanding (documented deferrals, not blocking)
- **PR #1 description** could not be updated programmatically (no update-PR tool,
  `gh` CLI absent). New commits attach to PR #1 automatically. A ready-to-paste
  summary was provided in chat; apply it manually if desired.
- **Concrete AWS SES v2 sender adapter** + background email-worker entrypoint
  (port + worker command exist).
- **`GET /v1/auth/web/csrf`** reload-recovery endpoint (deferred since BE-010).
- **BE-019A** Fastify hardening / descriptor-to-handler + security-control
  inventory (an audit task, not code).
- **Legacy migrations `001–008`** still physically present but excluded from the
  canonical baseline; the migrate CLI applies all files, so `001` (`users`)
  collides with `010` (`users`). Tests/composition assume `>= 009`. A CLEAN task
  should archive/remove `001–008` (or make the runner filter `>= 009`) before the
  migrate CLI is production-correct. **This is important** — see spec 03 §8
  disposition matrix.

## Working Agreement (keep doing this)
- Per batch: `cd backend_controller && npm run check` (typecheck + lint +
  coverage ≥80% + build + source/dist smoke) **and** `npm run test:integration`
  (podman-backed Postgres; currently 69 tests across 8 files) must both be green.
- Guards from repo root before commit:
  - `git diff --check`
  - Legacy tree immutable:
    `test "$(find resources/sessions/Legacy -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1)" = "d5fd7425d67bce6f52da178dbce9f5c27d0f36921d838115ccc9631755e93fee"`
  - Authored JS count stays 0:
    `find backend_controller/src backend_controller/scripts -type f \( -name '*.js' -o -name '*.jsx' \) | wc -l`
  - `git diff --quiet backend_controller/package.json backend_controller/package-lock.json`
- Coverage split: `src/**` non-DB code is unit-covered (`vitest.config.ts`);
  `src/repositories/**`, `src/routes/**`, `src/domain/**` are integration-covered
  (`vitest.integration.config.ts`, ≥80% branch). Put pure logic where it can be
  unit-tested.
- Stage files **explicitly by name**; never `git add .` — `semantic-review/` is
  untracked and must never be committed.
- Push via the GitHub power `push_to_remote` (owner `tamagami-hi`, repo `boe_app`,
  path `/projects/sandbox/boe_app`, remote branch `ts-migration/backend`), not
  `git push`. Re-push once after commit (a commit/push ordering race has been
  observed).
- Migration DDL conventions: `DO $$ BEGIN CREATE TYPE … EXCEPTION WHEN
  duplicate_object THEN NULL; END $$;`, `gen_random_uuid()` (pgcrypto from 009),
  lowercase/`snake_case`, `version bigint … CHECK (version > 0)`, `ON DELETE
  RESTRICT` (never cascade financial/identity), partial unique indexes for
  single-active invariants, and remember `CHECK` passes on `NULL` (use explicit
  `IS NOT NULL` guards in envelope checks).

## Key References
- Spec 03 §4 (later-domain schema), §5 (lifecycle command contract), §6 (atomic
  transactions/locking), §7 (repository interfaces), §8 (001–008 disposition).
- Spec 04 (API/security/test) — first-slice route inventory is exhaustive; later
  slices add the financial routes.
- Status: `resources/sessions/1/status/CURRENT.md`, `.../METRICS.md`.
- Per-batch logs: `resources/sessions/1/logs/README.md` (BE-010 … BE-021.1,
  PROD-001).

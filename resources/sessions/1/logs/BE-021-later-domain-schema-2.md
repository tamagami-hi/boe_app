# BE-021 Later-domain canonical schema — increment 2 (investing/ownership + payments)

Status: DONE (increment 2 of 2) — branch `ts-migration/backend` (PR #1).

Completes the spec-03 §4 canonical later-domain schema: the money-movement core
(§4.3 investing/ownership and §4.4 payments/provider inbox) as additive
migrations on the `>= 009` baseline, plus the Kysely `Database` types for **all**
later-domain tables (014-018), which increment 1 had deferred so types and
schema would land together. Schema-first: no repositories/routes yet — those are
the next batch.

## Migrations added

- `017_canonical_investing.sql` (§4.3, plus §4.4 `mandates` which `sip_plans`
  depends on). Enums `mandate_state`, `sip_state`, `order_type`, `order_state`,
  `execution_type`, `redemption_state`. Tables (dependency order): `mandates`
  (SIP ownership anchor via `(id,user_id)`; one mandate authorizes many SIPs),
  `sip_plans` (composite `(mandate_id,user_id)` FK, MATCH SIMPLE so enforced
  only once linked), `investment_orders` (type/amount/units checks: purchase &
  sip_installment require positive paise, redemption requires positive units,
  non-redemption prohibits units), `investment_executions` (append-only; refund
  = money-only evidence with provider reference, others require positive
  NAV+units; reversal self-FK on `(reverses_execution_id,order_id,user_id,
  fund_id)`; partial uniques for "one non-reversal booking per order", one
  reversal per original, and unique provider reference), `holdings`
  (authoritative ownership; reserved ≤ total), `holding_lots` (composite FKs to
  holding and source execution; one lot per source execution; remaining ≤
  original, reserved ≤ remaining), `holding_lot_movements` (append-only
  projection source; composite FKs bind lot/holding/execution to one
  owner/fund; allotment positive, redemption negative; unique
  `(execution_id,holding_lot_id,movement_type)`), `redemption_requests`
  (composite `(order_id,user_id)` FK, `finance_policy_version` FK to `016`,
  reserved ≤ requested).
- `018_canonical_payments.sql` (§4.4). Enums `payment_state`,
  `provider_event_state`. Tables: `payments` (one per order via composite
  `(order_id,user_id)` FK + unique order; `(id,user_id)` unique before
  referencing FKs; coherent state timestamps), `payment_attempts` (composite
  `(payment_id,user_id)` FK; state limited to the non-refund lifecycle; unique
  `(payment_id,attempt_number)` and provider pair), `provider_events` (signed
  inbound inbox: `CHECK (signature_valid)` rejects bad signatures; all-present
  AES-256-GCM envelope before erasure and all-null after `erased_at`; 32-byte
  digest retained; composite subject FKs to payments/mandates; partial claim
  index `(available_at,created_at,id) WHERE state='received'`), `notifications`
  (allowlisted JSON object payload; inbox index).

Money is integer paise in `bigint`; NAV/units/allocation are `numeric(24,8)`.
Booked financial evidence (orders/executions/holdings/lots/movements) is
append-only by domain rule and never cascaded (`ON DELETE RESTRICT` throughout).

## Types

`src/db/types.ts`: added the 13 later-domain enum unions and table interfaces for
**every** later-domain table (014-018), extended the `Database` map, and added
numeric/date/nullable-bigint column helpers (`Numeric`, `NumericDefault`,
`NullableNumeric`, `NullableBigIntString`, `DateColumn`, `NullableDateColumn`).
`src/db/repositories.ts`: added matching `Row<>` domain aliases (e.g., `Mandate`,
`InvestmentOrder`, `Payment`, `Holding`, `ProviderEvent`) for the next batch.

## Deviation / implementation choice

- `mandates.frequency`: spec §4.4 requires a closed supported set but does not
  enumerate it. Chosen canonical set: `weekly`, `monthly`, `quarterly`,
  `semi_annual`, `annual`, `as_presented` (documented inline in `017`).
- The "reversal reverses a *non-reversal* original" and money-math fold
  invariants (§4.3) that cannot be expressed declaratively remain
  domain-enforced, consistent with the increment-1 treatment of append-only.

## Validation

- `test/integration/laterDomainSchema.integration.test.ts` extended (+6 tests,
  12 total): money-core happy path (mandate → sip → order → payment → attempt →
  allotment execution → holding → lot → movement); cross-user composite-FK
  rejection on payments; one-non-reversal-booking-per-order; non-redemption
  order rejecting requested units; invalid provider-event signature rejected;
  redemption reserved ≤ requested. Applying migrations 009-018 is itself the
  primary DDL assertion.
- `npm run check` green (typecheck + lint + 294 unit tests + build + source/dist
  smoke). `npm run test:integration` green (75 tests across 8 files, was 69).
- Guards: `git diff --check` clean; Legacy tree hash intact
  (`d5fd7425…`); backend authored JS still 0; `package.json`/lock unchanged.

## Next

The later-domain schema is complete (spec 03 §4.1-§4.5). Next is the
repositories + command services + routes that consume it (spec 03 §6/§7 atomic
transactions, locking, and repository interfaces; spec 04 later financial
route slices), plus the still-open deferrals from handoff 07 (concrete SES v2
sender + email-worker entrypoint, `GET /v1/auth/web/csrf`, BE-019A hardening
audit, and archiving legacy migrations `001-008`).

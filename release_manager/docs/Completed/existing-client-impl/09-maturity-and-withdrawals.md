# Feature E — maturity, withdrawal and reinvestment

Status: **implemented and verified in the working tree; not deployed or committed.**
Written 2026-09-09 against the working tree (dirty; Features D, A, B and the growth-basis
correction are uncommitted). Line numbers below were read from the working tree and will drift.

Supersedes two earlier drafts of this document (`09-ledger-entry-type-extension-handoff.md`,
`09-money-out-handoff.md`), which were written before the ledger decision was taken and listed as
open the questions §2 now closes.

---

## The ask

A client's investment reaches maturity. An admin marks it, and then settles it one of two ways:

- **withdraw** any amount from ₹0 up to the position's current value; or
- **reinvest** the whole position, so the accumulated gain (or loss) becomes the new principal.

## Why this needs the money ledger extended

Everything in Features A–D was built without touching `client_value_entry_type`, and
[`04-recorded-contributions.md`](./04-recorded-contributions.md) went out of its way to avoid it.
Maturity cannot be done that way, and the reason is worth stating precisely, because it is the whole
justification for the migration.

| Operation | What the ledger must express | Why no existing type can |
|---|---|---|
| Withdrawal | `principal_delta ≤ 0`, `value_delta < 0` | `contribution` requires `principal_delta > 0`; `growth_adjustment` pins it to `0`; `reversal` can only negate one whole prior row, so it cannot express a partial withdrawal |
| Reinvestment | `principal_delta ≠ 0`, `value_delta = 0` | `contribution` requires `value_delta = principal_delta`; `growth_adjustment` requires `value_delta ≠ 0` |

The two alternatives were considered and rejected on the record:

- **Payout record only, ledger untouched.** Rejected: the client's displayed position would keep
  showing money that has left the firm.
- **Reinvestment as `growth_adjustment(−gain)` + a `recorded_offline` contribution `(+gain)`.**
  Rejected: the arithmetic is right but the provenance is a lie. `recorded_offline` means the client
  paid money outside the app. At maturity no new payment happens, and synthesising an
  `investment_orders` + `payments(succeeded)` pair would make the client's payment history claim a
  payment that never occurred.

**Closed decision:** extend `client_value_entry_type` with `withdrawal` and `maturity_reinvestment`.
Leave the `contribution`, `growth_adjustment` and `reversal` CHECKs exactly as they are.

## 1. Withdrawal arithmetic — growth is consumed first

Given locked authoritative `P = principal`, `V = current value`, and requested `W`:

```
require 0 < W <= V
G              = max(V - P, 0)
growthPortion  = min(W, G)
principalPortion = W - growthPortion

principal_delta_paise = -principalPortion
value_delta_paise     = -W
```

The frontend submits `W` only. The backend derives both deltas from the position it locked; a
browser-supplied delta is never trusted.

| Before (P / V) | W | principal Δ | value Δ | After (P / V) |
|---|---|---|---|---|
| 100,000 / 120,000 | 10,000 | 0 | −10,000 | 100,000 / 110,000 |
| 100,000 / 120,000 | 30,000 | −10,000 | −30,000 | 90,000 / 90,000 |
| 100,000 / 120,000 | 120,000 | −100,000 | −120,000 | 0 / 0 |
| 100,000 / 80,000 | 30,000 | −30,000 | −30,000 | 70,000 / 50,000 |

The last row is the one to keep in mind: with no positive growth there is nothing to consume, the
whole withdrawal comes out of principal, and the pre-existing −20,000 loss stays represented.

`W = 0` is not a withdrawal. It writes no ledger row; the database is not relaxed to admit
zero-delta entries.

## 2. Reinvestment arithmetic

```
principal_delta_paise = currentValue - principal      (signed, non-zero)
value_delta_paise     = 0
```

After it: `principal = current value`, value unchanged, growth exactly `0`. A profit is capitalised;
a loss is realised into the new principal basis. A position whose value already equals its principal
has nothing to roll over and is refused rather than written as a zero row.

## 3. Payout provenance is a separate record

There is **no payout, settlement, disbursement or withdrawal table anywhere** in migrations 009–049,
and **no bank-account or payout-destination column exists for any client** — the compliance tables
that might have held one were dropped in `042_remove_legacy_compliance_tables.sql`.

`refund_operations` is the only money-out table and cannot be reused: `payment_id` and `order_id` are
`NOT NULL` and both `UNIQUE`, so it is one-row-per-inbound-payment, while a maturity payout is
against accumulated value that spans contributions and has growth with no payment provenance at all
(`client_value_entries_growth_provenance` forbids it). Driving a refund would also flip an `accepted`
order to `refunded`, contradicting the contribution already in the ledger.

So a new operational record is added, modelled on `refund_operations`' shape rather than reusing it.
It stores **no account identifiers** — inventing an encrypted payout-destination surface is a
separate decision, and the transfer reference an operator pastes in is enough to reconcile against a
bank statement.

The invariant is `payout record + withdrawal ledger entry`, never one without the other, and the two
states stay independent: reversing the ledger entry must not imply the money came back.

## 4. Every reader that must change

Verified by reading source. The two accounting folds are the dangerous ones, and neither has a
`default` or an exhaustiveness guard, so **widening the union produces no TypeScript error at all**.

| Site | Behaviour if left alone | Severity |
|---|---|---|
| `domain/client/statements.ts` `deriveStatements` | `closingValuePaise` is rebuilt from three buckets, so a withdrawal's negative `value_delta` lands in none of them — while `totalInvestmentPaise` accumulates outside the switch and *does* pick up the principal. The statement contradicts itself, and `openingValue = closingValue` compounds the drift into every later month. | **corrupts a total** |
| `domain/client/portfolioLedger.ts` `derivePortfolio` | Headline totals survive, because both accumulate before the switch. Every breakdown counter silently under-reports. | wrong breakdown |
| `repositories/clientGrowthRepository.ts` | Sums are exclusion-based (`entry_type <> 'reversal'`) so they stay right by accident. `having bool_or(entry_type = 'contribution')` means a position with no unreversed contribution disappears from growth targets. A fully withdrawn position retains its contribution and is still returned with zero value; callers handle that explicitly. | safe, verify |
| `routes/clientPortfolioRoutes.ts` `mapTransaction` | Catch-all `: "adjustment"` is schema-valid, so a withdrawal would be shown to the investor as a *correction*. | silently misleading |
| `packages/contracts` `LedgerEntryType`, `AdminLedgerEntry.entryType` | Strict enums; the admin one returns the raw database value and fails loudly. | loud, good |
| `frontend_stack_ts` `ActivityScreen` `LABEL`/`TONE` | `as const` maps indexed by the contract type — the only compile-time guard in the chain, and it only fires once the contract enum widens. | loud, good |
| `db/migrations/018` `*_shape` CHECKs | Both go vacuously true for a new type, leaving it shape-unconstrained. New explicit CHECKs are required. | must add |
| `db/migrations/018` `_allocation_link`, `_reversal_link` | Equalities, not implications, so new types are forced to `allocation_id IS NULL` and `reverses_entry_id IS NULL`. Already correct for both new types. | already right |
| AUM | Structurally decoupled — reads only `fund_aum_snapshots`, never `client_value_entries`. A client withdrawal therefore does **not** reduce published fund AUM. | flagged, not fixed |

Add `never` exhaustiveness guards to both folds **before** widening the union, so the compiler
enumerates the remaining work instead of leaving it to review.

## 5. Migration order

`ALTER TYPE ... ADD VALUE` may run inside the runner's transaction, but the new label cannot be
*used* in that same transaction — the precedent and its explanation are in
`046_client_web_sessions.sql`. So the enum additions and anything naming them are separate files.

```
050  ALTER TYPE client_value_entry_type ADD VALUE 'withdrawal'
     ALTER TYPE client_value_entry_type ADD VALUE 'maturity_reinvestment'
051  new shape CHECKs naming those labels
     client_position_maturities, withdrawal_operations, and their enums
```

`client_position.write` already covers the money writes and is seeded, not migrated — so
`npm run seed` must run against the target database, exactly as for `clients.create`.

## 6. Completion and verification

The repository, settlement domains, payout status transitions, admin routes, contracts and generated
clients, admin UI, and client statement/activity readers are implemented. Zero withdrawals and
zero-gain reinvestments are rejected without a ledger write. Total-loss positions can be marked
matured and have their remaining principal reset by reinvestment. Partial withdrawal settles that
maturity; any subsequent settlement requires a new maturity record.

Maturity marking and settlement validate real dates, reject future dates, and reject dates before
the latest effective ledger entry. Settlement cannot precede the maturity date. Arithmetic uses the
current authoritative position under the shared transaction advisory lock. Verified-payment
contributions now use the same lock before their dependent writes.

Reversals retain separate payout state and now reject negative final balances, residual values after
removing the last contribution, and negative historical daily balances. A reversal never claims that
a bank transfer was returned. Published AUM still comes from its separate snapshot records.

Migrations 048–051 ran successfully on disposable PostgreSQL through the existing migration runner.
Financial integration tests verified settlement/replay/concurrency, payout rollback, permission/CSRF
boundaries, payout version-zero updates, reinvestment, malformed ledger CHECK rejection, and historical
reversal protection. The portfolio and statement folds have targeted regression coverage.
See [`10-completion-plan.md`](./10-completion-plan.md) for exact final checks and unrelated suite failures.

No shared database was migrated and no bank transfer was executed. Deployment must run pending
migrations in order (050 commits its enum additions before 051 uses them), then run `npm run seed`
against the target database to apply `client_position.write` and the other new permission grants.
The maturity record starts at version 1 to match the positive audit-version constraint; payout
records start at version 0 and status updates accept that initial version.

# Feature B — recording investments made before the app existed

A client invested through the firm before the app existed. Their app portfolio must show it.

This is the hardest feature in the plan, and the only one that touches the money ledger.

---

## 1. What cannot be done, and why

**Editing a stored balance.** There is no stored balance. The client's figures are folded from
`client_value_entries` on every read ([`00-constraints.md`](./00-constraints.md) §3). There is no
number to edit.

**Using `growth_adjustment`.** The database enforces `principal_delta_paise = 0` on that entry type
([`00-constraints.md`](./00-constraints.md) §2). It is not merely wrong in spirit — the insert
fails. And if it somehow succeeded it would show the right total against zero invested, corrupting
total-invested, gain, and the statement fold.

**Using `fund_receipt_acknowledgements`.** Not a route in: acknowledgement requires the
contribution to already exist.

That leaves appending a `contribution`, which the database says must name an order, a payment and
an allocation.

## 2. The approach: record what actually happened

The client *did* place an order and *did* pay. It simply did not happen through PhonePe. So write
that:

```
investment_orders     type = recorded_offline, state = accepted,
                      amount_paise = the real amount
        │
payments              state = 'succeeded', succeeded_at = the real historical date
        │             (no payment_attempts row — see §3)
        │
investment_allocations
        │
client_value_entries  entry_type = 'contribution',
                      principal_delta = value_delta = amount,
                      effective_date = the real historical date,
                      actor_type = 'admin', created_by_user_id = the admin,
                      reason_code = 'recorded_offline_investment'
```

All in one transaction. No CHECK is weakened. No ledger migration. Every existing reader —
portfolio, statements, AUM, growth basis — works untouched, because these are ordinary rows.

## 3. Why creating no `payment_attempts` row is correct and safe

This was the open question when this plan was first drafted; it is now settled, on three findings
in [`00-constraints.md`](./00-constraints.md) §6–§7.

**It must not be created.** `payment_attempts.provider` is `CHECK (provider = 'phonepe')`. An
offline payment cannot honestly satisfy that, and widening the CHECK would weaken a real
constraint to accommodate a non-PhonePe row.

**Client reads survive without it.** `clientPortfolioRepository.ts:167` uses
`left join lateral` onto `payment_attempts`. A payment with no attempt returns normally with the
attempt-derived fields null, and nullability is already a handled case elsewhere
(`fundReceiptAcknowledgementRepository.ts:24` types `merchantOrderId: string | null`).

**Reconciliation will never touch it.** The reconciliation worker enumerates
`selectFrom("payment_attempts")`, not payments. With no attempt row, a recorded payment is invisible
to it — so it can never be "reconciled" against a provider that never saw it. This is the property
that makes the whole approach safe, and it is worth re-checking if the worker is ever rewritten.

## 4. The marker

These rows must be distinguishable from gateway payments forever, by anyone writing a future query.
Two markers, at different levels:

- **`order_type` gains `recorded_offline`.** `order_type` is currently
  `('lump_sum', 'sip_installment')` — a small enum extension. This is the primary marker and it
  sits in the right place: the order is the thing that describes *what kind of investment this was*.
- **`reason_code`** on the ledger row, which is already mandatory
  (`CHECK (btrim(reason_code) <> '')`).

Extending `order_type` is preferred over adding a boolean to `payments` because far fewer readers
switch on `order_type` than on payment fields, and because it is descriptive rather than a flag.
Every `switch` on `order_type` must be found and handled — that is the migration's blast radius, and
it is small enough to enumerate.

### The alternative that was rejected

Adding a fourth `client_value_entry_type` (`recorded_contribution`) with a CHECK allowing
`principal_delta > 0` without payment provenance.

- More honest — it does not synthesise a payment.
- But it is a migration to the **money ledger's** enum and constraints, and every reader that
  switches on `entry_type` must handle it: `domain/client/statements.ts`,
  `clientPortfolioRoutes.ts`, `clientAccountRoutes.ts`, `clientGrowthRepository.ts`,
  `db/types.ts:126`, plus the AUM surface. Miss one and a client's total silently disagrees between
  two screens.

Chosen against because the blast radius is larger and lands on the money fold. Revisit only if the
team decides synthesising a payment row is unacceptable in principle — see
[`07-open-decisions.md`](./07-open-decisions.md) D-1.

## 5. Endpoint

```
POST /v1/admin/clients/:userId/recorded-contributions
     permission: a new one, e.g. client_position.write
```

Body: `fundId`, `amountPaise` (decimal string), `effectiveDate` (the real historical date),
`reasonCode`, optional `note`.

Requirements, following `adminClientGrowthRoutes.ts`:

- **Idempotency** via `runAdminMutation`, so a retried request cannot double-record an investment.
  This is the single most important property here.
- **Lock the position** before writing, as the growth path does with `lockPosition`.
- `effective_date` is the **historical** date, not today, or the entry lands in the wrong statement
  period.
- `amountPaise > 0` is enforced by the database on both `payments` and `investment_orders`; validate
  it at the edge too so the error is a 400 rather than a constraint violation.
- A `fund_version_id` is required by `investment_orders`. Decide explicitly whether to record
  against the fund version current at the historical date or the version current now — the former is
  more truthful, the latter is simpler. This detail is easy to miss until the insert fails.

## 6. This feature needs the reversal writer

An admin recording a ₹5,00,000 investment as ₹50,00,000 currently has no remedy: nothing in the
codebase writes a `reversal`, and application roles never UPDATE or DELETE the ledger
([`00-constraints.md`](./00-constraints.md) §4).

Ship a reversal path with this feature:

```
POST /v1/admin/clients/:userId/ledger-entries/:entryId/reversal
```

It writes a `reversal` row that exactly negates the named entry. The schema already supports it —
FK, shape CHECK, and a unique index ensuring one row is reversed at most once. The read side already
handles reversals (`clientGrowthRepository.ts:88` excludes reversed pairs from the basis; statements
fold them).

Note this also fixes the same gap for growth adjustments, which have been un-undoable since they
shipped. That is a bonus, not scope creep — it is the same writer.

## 7. Work items

1. Migration: extend `order_type` with `recorded_offline`; add the `client_position.write`
   permission.
2. Find and handle every `switch`/comparison on `order_type` (§4).
3. `domain/admin/recordContribution.ts` — the four-insert transaction.
4. `domain/admin/reverseLedgerEntry.ts` — the reversal writer (§6).
5. `routes/adminClientPositionRoutes.ts` — both endpoints, wrapped in `runAdminMutation`.
6. Admin console: the action on the client-detail screen from
   [`05-per-client-growth.md`](./05-per-client-growth.md), plus a ledger view showing entries with a
   reverse action.
7. Decide and implement the notification question — [D-6](./07-open-decisions.md).

## 8. Tests required

- A recorded contribution appears in the client's portfolio total and in total-invested.
- It lands in the statement period of its `effective_date`, not of today.
- The payment it creates is **not** picked up by the reconciliation worker.
- The client's payment-detail read succeeds with null provider and merchant order id.
- Retrying the same request does not double-record (idempotency).
- `amountPaise` of zero or negative is refused.
- A reversal exactly negates the entry and the portfolio returns to its prior total.
- An entry cannot be reversed twice.
- A reversal of a growth adjustment also works.
- Missing the permission is refused.
- The architecture guard test still passes — no new source file contains `holdings`.

## 9. Definition of done

An admin can enter a legacy client's prior investment with its true date and amount; the client sees
a correct portfolio and a correct statement for the historical period; the entry is attributable to
the admin who made it; and a mistake can be reversed without touching the database by hand.

## 10. Risks

**Double-recording.** The highest-consequence defect. A retried or double-clicked request that
records twice inflates a client's position with no obvious signal. Idempotency via
`runAdminMutation` is mandatory, not optional.

**Wrong `effective_date`.** Silently produces correct totals with wrong statements. Only caught by
a test that asserts the statement period.

**A future reader that assumes every payment has an attempt.** True today (§3), but a new
`innerJoin("payment_attempts")` would silently hide recorded payments from whatever it feeds. Worth
a comment in the guard test if one can be expressed there.

**Scope.** If this is really a bulk migration of many clients, the endpoint shape above is wrong —
see [D-5](./07-open-decisions.md).

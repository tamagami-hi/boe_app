# Constraints

The verified invariants that shape every design in this plan. Other documents reference these
sections rather than restating them.

These are facts about the code at `4083ef4`, not preferences. Each one rules out an approach that
would otherwise look reasonable.

---

## 1. Investing eligibility is derived, never stored

`backend_controller/src/domain/client/investingEligibility.ts` is the single decision function:

```ts
if (accountState === "closed" || accountState === "suspended") return "suspended"
if (accountState !== "active")                                 return "blocked"
if (emailVerification === null || emailVerification.state !== "verified")
                                                               return "pending_verification"
return "eligible"
```

Its own header states eligibility "is never stored in configuration, a JWT claim, or a client-owned
row", and that the investing command **re-derives it under lock before accepting money**.

**Consequences**

- Eligibility cannot be granted by an admin flag, and does not need to be.
- An account created with `account_state = 'active'` and no verified email is automatically
  `pending_verification`. The email-verification-before-investing requirement is satisfied by
  writing no code at all.
- Any "admin override" on this gate would make the derivation a liar and put the money gate under
  admin control. Do not add one.

## 2. The value ledger has exactly three entry shapes, all CHECK-enforced

`client_value_entry_type` is `('contribution', 'growth_adjustment', 'reversal')`
(`db/migrations/017_canonical_investing.sql:28`).

`ledger_actor_type` is `('admin', 'system')` (`:32`).

The shapes are enforced in the database, in `db/migrations/018_canonical_payments.sql`:

```sql
CONSTRAINT client_value_entries_contribution_shape CHECK (
  entry_type <> 'contribution'
  OR ( principal_delta_paise > 0
       AND value_delta_paise = principal_delta_paise
       AND order_id IS NOT NULL
       AND payment_id IS NOT NULL
       AND allocation_id IS NOT NULL ) ),

CONSTRAINT client_value_entries_growth_shape CHECK (
  entry_type <> 'growth_adjustment'
  OR ( principal_delta_paise = 0
       AND value_delta_paise <> 0
       AND growth_batch_id IS NOT NULL
       AND actor_type = 'admin'
       AND created_by_user_id IS NOT NULL ) ),

CHECK ((entry_type = 'contribution') = (allocation_id IS NOT NULL)),
CHECK ((entry_type = 'reversal')     = (reverses_entry_id IS NOT NULL)),
CHECK (entry_type <> 'growth_adjustment' OR (order_id IS NULL AND payment_id IS NULL))
```

**Consequences**

- **Only a `contribution` can move principal**, and it must name an order, a payment and an
  allocation. There is no way to add principal without payment provenance.
- **`growth_adjustment` cannot be repurposed** to record a past investment. `principal_delta = 0`
  is enforced by the database, so the attempt fails outright rather than merely being wrong in
  spirit.
- The ledger is the only way to change what a client sees, because there is no stored balance
  (§3).

## 3. Client figures are folded from the ledger on every read

`clientPortfolioRoutes.ts` and `domain/client/statements.ts` compute the client's position by
folding `client_value_entries`. There is no cached or stored balance anywhere.

**Consequences**

- "Edit the client's total" is not a possible operation. The only lever is appending ledger rows.
- That is a feature, not an obstacle: it means every adjustment is auditable by construction, and
  an admin action takes effect purely by inserting rows.
- Statements fold `opening + contributions + growth + reversals`, so `effective_date` matters —
  backdating an entry changes which statement period it lands in.

## 4. Corrections are meant to be reversals, and nothing writes one

The migration comment is explicit:

> Corrections are a reversal followed by a correct new entry; application roles never UPDATE or
> DELETE.

The `reversal` entry type exists, with its FK, its shape CHECK, and a unique index enforcing that
one row is reversed at most once. **No code writes one.** Every reference in `src/` is a read:

- `clientGrowthRepository.ts:88` excludes reversals from the position basis
- `clientPortfolioRoutes.ts:224` and `clientAccountRoutes.ts:410` aggregate them
- `domain/client/statements.ts` folds them
- `db/types.ts:126` declares the union member

**Consequence:** today, an admin money write cannot be undone by any route. The first mistyped
growth adjustment is permanent. Any feature that lets an admin write money should ship its
correction path. See [`04-recorded-contributions.md`](./04-recorded-contributions.md) §6.

## 5. The word `holdings` breaks the build

`backend_controller/src/investment-architecture.guard.test.ts:127` scans every non-test source file
except `db/seedContent.ts`:

```ts
if (/\bholdings\b/u.test(code)) offenders.push(`${file}: holdings`)
```

The same test also fails on references to dropped tables, and on `mandates` outside an allow-list.

**Consequence:** name nothing in this work `holdings`. Use **position** — the vocabulary
`clientGrowthRepository` already uses (`lockPosition`, `findPositionBasis`) — or **contribution**.

## 6. `payments` is provider-agnostic; `payment_attempts` is PhonePe-only

The `payments` table has **no provider, gateway or method column**
(`db/migrations/018_canonical_payments.sql`):

```sql
CREATE TABLE payments (
  id, order_id, user_id,
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  currency char(3) NOT NULL DEFAULT 'INR',
  state payment_state NOT NULL DEFAULT 'created',
  succeeded_at, failed_at, refunded_at, created_at, updated_at,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0), ...)
```

Provider specifics live one level down, and are pinned to one provider:

```sql
CREATE TABLE payment_attempts (
  ...
  provider text NOT NULL CHECK (provider = 'phonepe'),
  merchant_order_id text NOT NULL, ...)
```

**Consequences**

- A payment that did not come from a gateway is **already representable**, with no schema change.
- An *attempt* for such a payment is not representable without widening that CHECK — so do not
  create one. This is what makes [`04-recorded-contributions.md`](./04-recorded-contributions.md)
  cheap.

## 7. A payment with no attempt is safe

Two independent checks confirm this, and together they decide Feature B.

**Client reads use an outer join.** `clientPortfolioRepository.ts:167`:

```sql
from payments p
join investment_orders o on o.id = p.order_id
left join lateral (
  select provider, merchant_order_id, provider_order_id, state, failure_code, checkout_expires_at
  from payment_attempts
  where payment_id = p.id
  order by attempt_number desc limit 1
) a on true
```

`left join lateral` — a payment with no attempt still returns, with the attempt-derived fields
null. `fundReceiptAcknowledgementRepository.ts:24` already types `merchantOrderId: string | null`,
so nullability is an existing, handled case.

**Reconciliation drives off attempts, not payments.** Every selection in `paymentsRepository.ts`
that the reconciliation worker uses reads `selectFrom("payment_attempts")` (`:220`, `:231`, `:241`,
`:250`, `:670`). A payment with no attempt row is never enumerated, so it can never be
"reconciled" against a provider that never saw it.

The only two `innerJoin("payment_attempts")` in the codebase are in `mandatesRepository.ts:729`
and `:732`, both starting from `mandate_collection_attempts` — they join *from* attempts, so they
do not assume every payment has one.

## 8. Relevant enum vocabularies

```
payment_state       created | provider_pending | succeeded | failed | expired
                    refund_pending | refunded | refund_failed
order_state         submitted | payment_pending | review_pending | accepted
                    refund_pending | refunded | refund_failed | payment_failed | cancelled
order_type          lump_sum | sip_installment
client_value_entry_type   contribution | growth_adjustment | reversal
ledger_actor_type   admin | system
```

`succeeded` is the terminal success state for a payment; `accepted` for an order.

## 9. Money representation

Integer paise in `bigint` throughout the database, `BigInt` in TypeScript, serialised to clients as
decimal strings. Never floats, never JavaScript `number` for money.

`amount_paise > 0` is CHECK-enforced on both `payments` and `investment_orders`, so a zero or
negative recorded investment is rejected by the database.

## 10. Token handling precedent

`email_verification_codes` (`db/migrations/040_email_verification_schema.sql:11`) is the
established pattern for anything token-shaped, and it is a good one. Reproduced and discussed in
[`02-credential-lifecycle.md`](./02-credential-lifecycle.md) §2.

The properties to carry over: keyed hash at rest with a recorded key version, an attempt counter,
an expiry, a consumed-at, and a partial unique index enforcing at most one active token per user.

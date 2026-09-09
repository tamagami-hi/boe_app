# Sequencing and migrations

---

## 1. Build order

```
1. D  credential lifecycle          02-credential-lifecycle.md
2. A  admin-created accounts        03-admin-created-clients.md
3. C  position read + admin UI      05-per-client-growth.md
4. B  recorded contributions        04-recorded-contributions.md
      + the reversal writer
```

The dependencies are real, not stylistic:

- **D before A.** An admin-created account has no password and no way to get one until the
  set-password flow exists. A is a few hours' work after D and impossible before it.
- **C before B.** B's action needs the client-detail screen that C builds. Doing B first means
  building that screen anyway, with nowhere to observe the result.
- **D is also independently shippable.** Password reset has standalone value and no dependency on
  anything else here, so it can go out on its own while the rest is still being designed.

## 2. Migrations

Each is small. None is destructive.

| # | For | Change | Blast radius |
|---|---|---|---|
| 1 | D | `password_credential_tokens` table, modelled on `email_verification_codes` | New table. None. |
| 2 | A | `clients.create` permission row + role grant | New rows. None. |
| 3 | C | `client_growth.read` permission, **if** D-7 chooses a separate read permission | New rows. None. |
| 4 | B | Extend `order_type` with `recorded_offline` | **Every reader that switches on `order_type`.** Enumerate them. |
| 5 | B | `client_position.write` permission row + role grant | New rows. None. |

Only migration 4 has any reach. `order_type` is currently `('lump_sum', 'sip_installment')`, and
extending a Postgres enum is additive and safe at the database level — the work is in the
application, finding every place that switches on it and deciding what the new member does there.

Follow the existing idempotent enum pattern:

```sql
DO $$ BEGIN
  CREATE TYPE ... ;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

For extending an existing enum, `ALTER TYPE order_type ADD VALUE IF NOT EXISTS 'recorded_offline'`.
Note that in older Postgres an `ALTER TYPE ... ADD VALUE` could not run inside a transaction block
with subsequent use of the new value — check the target server version before assuming the migration
runner's transaction wrapping is fine.

**No migration weakens a CHECK constraint.** That is a deliberate property of this plan: the money
invariants in [`00-constraints.md`](./00-constraints.md) §2 survive it intact. If a proposed change
requires relaxing one, treat that as a signal the design is wrong and revisit
[D-1](./07-open-decisions.md).

## 3. Deploy ordering

The rule from `release_manager`: **migrations are applied before the code that depends on them.** A
release whose code writes a column added by a pending migration must have that migration applied
first.

Practically, for each feature: land the migration in an earlier release than the route that uses it,
or apply the migration as an explicit pre-step of the same release. Do not ship a release where the
new route and its schema arrive together and the order is left to chance.

The reverse also matters for migration 4: once code writes `order_type = 'recorded_offline'`, a
rollback to a build that does not understand that value will encounter rows it cannot classify.
Enum extensions are effectively one-way in a live system. Confirm the readers handle the unknown
case gracefully **before** the first write, not after.

## 4. Suggested release cuts

| Release | Contents | Notes |
|---|---|---|
| n+1 | Migration 1 | Schema only, no behaviour change. |
| n+2 | Feature D routes + client screens | Password reset live. Independently valuable. |
| n+3 | Migration 2, Feature A | Admin can create accounts. |
| n+4 | Migration 3 (if needed), Feature C read endpoint + admin UI | Admin can see and adjust growth. |
| n+5 | Migrations 4–5 | Schema only. Verify `order_type` readers first. |
| n+6 | Feature B + reversal writer | The ledger write, last, on top of a UI that can show it. |

Splitting schema from behaviour keeps every release rollback-safe except n+6, which is the one that
warrants the most care.

## 5. Verification per release

The full gate, all of which is runnable on the development machine:

```
cd frontend_stack_ts  && npm run typecheck && npx eslint . && npx vitest run
cd backend_controller && npm run typecheck && npm test
cd release_manager    && for t in tests/*.test.sh; do bash "$t"; done
```

At the time of writing that is 212 frontend tests, 804 backend tests, 15/15 release_manager tests,
with both typechecks and eslint clean.

**What the gate cannot tell you.** It does not exercise wiring. It would not catch a button whose
handler is never passed, an admin form posting a stale basis, or an invite email recorded as sent by
a transport that discards it. Anything in this plan that touches email delivery, the admin console's
actual behaviour, or a real ledger write needs to be exercised on the deployed stack before it is
called done. State plainly which of the two you have.

Feature B in particular has a claim no unit test can make for you: that a recorded payment is never
picked up by the reconciliation worker. That wants observation on a running system with the worker
active.

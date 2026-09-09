# Evidence

What was verified, how, and what was not. Read this before trusting any claim in the plan.

Verified against `boe_app@v0.13.5` (`4083ef4`), clean tree, 2026-09-08. Method: reading source and
migrations in the working tree, plus HTTP probes against the deployed dev host. **No database was
queried and no code was executed** beyond the existing test suites.

---

## 1. Verified by reading source

| Claim | Evidence |
|---|---|
| Eligibility is derived from account state + email verification, and re-derived under lock before money moves | `src/domain/client/investingEligibility.ts` — full function quoted in [`00-constraints.md`](./00-constraints.md) §1; the lock claim is from the module's own header |
| Ledger entry types are `contribution`, `growth_adjustment`, `reversal` | `db/migrations/017_canonical_investing.sql:28` |
| `ledger_actor_type` is `admin`, `system` | `db/migrations/017_canonical_investing.sql:32` |
| Only a contribution can move principal, and needs order + payment + allocation | `client_value_entries_contribution_shape` CHECK, `db/migrations/018_canonical_payments.sql` |
| `growth_adjustment` is pinned to `principal_delta_paise = 0` | `client_value_entries_growth_shape` CHECK, same file |
| A contribution has an allocation and nothing else does | `CHECK ((entry_type = 'contribution') = (allocation_id IS NOT NULL))` |
| Client figures are folded from the ledger, not stored | `routes/clientPortfolioRoutes.ts`, `domain/client/statements.ts` |
| Nothing writes a `reversal` | `grep -rn "reversal" src --include=*.ts` — every hit is a read: `clientGrowthRepository.ts:88`, `clientPortfolioRoutes.ts:224`, `clientAccountRoutes.ts:410`, `domain/client/statements.ts`, `db/types.ts:126` |
| The word `holdings` fails the build | `src/investment-architecture.guard.test.ts:127` |
| `payments` has no provider/method column | `CREATE TABLE payments`, `db/migrations/018_canonical_payments.sql` |
| `payment_attempts.provider` is pinned to PhonePe | `CHECK (provider = 'phonepe')`, same file |
| Client payment reads outer-join attempts | `repositories/clientPortfolioRepository.ts:167` — `left join lateral` |
| Reconciliation enumerates attempts, not payments | `repositories/paymentsRepository.ts:220`, `:231`, `:241`, `:250`, `:670` — all `selectFrom("payment_attempts")` |
| The only inner joins onto attempts start from mandate collections | `repositories/mandatesRepository.ts:729`, `:732` |
| Enum vocabularies in [`00-constraints.md`](./00-constraints.md) §8 | `db/migrations/017_canonical_investing.sql:13,17`; `db/migrations/018_canonical_payments.sql:14` |
| `CredentialWriteRepository` has only `exists` and `create` | `repositories/credentialRepository.ts:10` |
| No password-reset or forgot-password module exists | `grep -rln "password.reset\|passwordReset\|forgot" src --include=*.ts` returns nothing |
| Approval copies the password hash from the application row | `domain/admin/decideApplication.ts:112` |
| `email_verification_codes` schema and its one-active-per-user index | `db/migrations/040_email_verification_schema.sql:11–31` |
| The token consume discipline to copy | `domain/client/emailVerification.ts` — lock, expiry, attempt cap, `bytesEqual`, consume; returns a discriminated union |
| High-entropy token minting already exists | `crypto/context.ts:88` — `generateVerificationToken()` over `generateOpaqueToken()` |
| Keyed hashing with versioned keys | `crypto/context.ts:89,101` |
| Session revocation already exists | `repositories/authSessionRepository.ts:125` — `revokeAllForUser`, returns revoked counts |
| The per-client growth commit contract, ceiling, lock and basis hash | `routes/adminClientGrowthRoutes.ts:262` onward |
| No admin growth UI exists | **WRONG — corrected 2026-09-08.** The grep was case-sensitive and missed `ClientGrowth`. `features/admin/client-values/` already held `ClientPositionsScreen.tsx`, `IndividualClientGrowthScreen.tsx` and `CollectiveClientGrowthScreen.tsx` |
| Admin route conventions | `routes/adminAumRoutes.ts`, `routes/adminRouteKit.ts`, `domain/admin/adminAccess.ts` |
| Route manifest enforces reachability | `frontend_stack_ts/src/app/routing/routeIntegrity.test.ts` |

## 2. Verified by probing the deployed dev stack

Read-only HTTP, no state changed:

```console
$ curl -sI https://dev-app.beonedge.in/.well-known/assetlinks.json
200 application/json   # App Link association is live and correct
```

Relevant only to [D-4](./07-open-decisions.md): the App Link mechanism works on the dev host, so a
deep-linked reset is technically available if wanted.

## 3. Verified by running the test suites

On the development machine, at `4083ef4`:

```
frontend_stack_ts   typecheck clean, eslint clean, 22 files / 212 tests pass
backend_controller  typecheck clean, 79 files / 804 tests pass
release_manager     15/15 tests/*.test.sh pass
```

This establishes the baseline the plan must not regress. It establishes nothing about the features
themselves, which do not exist yet.

## 4. Assumed — check before relying on it

| Assumption | Why it matters | How to check |
|---|---|---|
| Extending `order_type` has a small, enumerable set of readers | Sizes migration 4 in [`06`](./06-sequencing-and-migrations.md) | `grep -rn "order_type\|lump_sum\|sip_installment" src --include=*.ts` and read each hit |
| The reconciliation worker's behaviour will not change to enumerate payments | The safety of a payment with no attempt ([`00`](./00-constraints.md) §7) depends on it | Re-read `paymentReconciliationEntrypoint.ts` and its repository calls before building Feature B |
| The admin console has a client list or search screen | Decides whether [`05`](./05-per-client-growth.md) §3 surface 1 is new work | Read `frontend_stack_ts/src/app/routing/adminRoutes.ts` |
| Permissions are seeded by migration or by a seed script | Decides what granting `clients.create` involves operationally | Find where `client_growth.write` is seeded and copy it |
| The signup application's exact field set | [`03`](./03-admin-created-clients.md) §5 — admin-created accounts must not be shaped differently | Read `routes/publicOnboardingRoutes.ts` |
| `ALTER TYPE ... ADD VALUE` is safe inside the migration runner's transaction on the target Postgres version | Migration 4 could fail at deploy time | Check the server version and the runner's transaction handling |
| Every fund has a `fund_versions` row covering historical dates | [D-8](./07-open-decisions.md) — the `fund_version_id` for a backdated order | Query `fund_versions` date coverage for the funds in question |

## 5. Not investigated at all

- **Bulk import.** Deliberately out of scope, see [D-5](./07-open-decisions.md).
- **The admin console's current information architecture** beyond the route manifest — no screens
  were read, so [`05`](./05-per-client-growth.md) §3 describes what is needed, not how it fits what
  exists.
- **Notification templates and copy** for any of the new flows.
- **Rate-limiting infrastructure** beyond the resend-cooldown pattern in `emailVerification.ts`. If
  a shared limiter exists, [`02`](./02-credential-lifecycle.md) §4 should use it.
- **Whether the AUM surface needs to know** about recorded contributions. They increase principal,
  so totals will move; whether any AUM reconciliation or reporting needs to distinguish them was not
  established.
- **The `fund_receipt_acknowledgements` flow** beyond confirming it requires the contribution to
  exist first, so it cannot substitute for Feature B.

## 6. A note on the plan's confidence

The parts most likely to be wrong are the ones in §4, and of those the `order_type` reader count is
the one that could change a recommendation: if `order_type` turns out to be switched on in twenty
places including the statement fold, the trade-off in [D-1](./07-open-decisions.md) narrows
considerably and the fourth-entry-type option becomes more attractive.

Everything in §1 was read directly and is quoted in the documents that depend on it, so those claims
can be re-checked in seconds rather than re-derived.

# Current state

How a client account comes into existence today, and an inventory of what already exists against
what this plan has to build.

---

## 1. The one existing path to an account

```
landing page signup
      │  publicOnboardingRoutes.ts
      ▼
applications row  ── carries the applicant's own password_hash
      │
      │  admin approves        domain/admin/decideApplication.ts
      │  creates the user, and creates the credential from
      │  the application's password_hash (:112)
      ▼
users row, account_state = 'active'
      │
      │  email verification code issued
      │  domain/client/emailVerification.ts
      ▼
client enters the 6-character code  ──>  state = 'verified'
      │
      ▼
deriveInvestingEligibility -> "eligible"     (00-constraints §1)
```

### The structural point that matters

**The password comes from the applicant, through the application row.** Approval never invents one;
it copies `application.password_hash` into a new credential.

An admin-created account has no application row, therefore no password hash, therefore no way to
authenticate. This is why [`02-credential-lifecycle.md`](./02-credential-lifecycle.md) is built
before [`03-admin-created-clients.md`](./03-admin-created-clients.md).

## 2. Email verification, as built

`domain/client/emailVerification.ts` is worth reading before writing any token flow, because the
credential work should mirror it.

- 6-character code from a 62-character alphabet, `randomInt`-generated.
- Stored only as `crypto.hashToken(code)` — an HMAC — with the key version recorded.
- `requestEmailVerificationCode` enforces a resend cooldown and throws
  `AppError("RATE_LIMITED", { retryAfterSeconds })`.
- `verifyEmail` locks the active code row, then checks expiry, then the attempt cap, then compares
  with the constant-time `bytesEqual`, incrementing `attempt_count` on mismatch.
- Returns a discriminated union — `verified | already_verified | no_active_verification | no_code |
  expired | locked | invalid` — so the route maps outcomes to responses instead of catching
  exceptions.
- Appends an audit row with `command: "email_verification.completed"`, `fromState`, `toState`,
  `entityVersion`, `requestId`.

## 3. Inventory

### Already exists and is usable as-is

| Thing | Where | Note |
|---|---|---|
| Per-client growth commit | `routes/adminClientGrowthRoutes.ts:262` | Full implementation. Locking, basis hash, idempotency, RBAC, audit, notification. |
| Collective growth commit | same module | Batch equivalent. |
| Position basis query | `repositories/clientGrowthRepository.ts` | `lockPosition`, `findPositionBasis`. Called internally by the commit path. |
| High-entropy token minting | `crypto/context.ts:88` | `generateVerificationToken()` returns `{ token, hash, keyVersion }`. |
| Keyed token hashing | `crypto/context.ts:89` | `hashToken(raw)` -> `{ hash, keyVersion }`. |
| Constant-time compare | `crypto/primitives.ts` | `bytesEqual`. |
| Session revocation | `repositories/authSessionRepository.ts:125` | `revokeAllForUser(tx, { userId, reason, now })`, returns revoked counts. |
| Admin mutation wrapper | `routes/adminRouteKit.ts` | `runAdminMutation` — idempotency, audit, the shared admin vocabulary. |
| Admin money-route template | `routes/adminAumRoutes.ts` | The pattern to copy: locking, basis hash, audit append. |
| Admin auth + RBAC | `domain/admin/adminAccess.ts` | Session resolution across transports, per-request live permission check. |
| Outbox + email worker | `repositories/outboxRepository.ts`, `worker:email` | Delivery path email verification already uses. |
| Email verification | `domain/client/emailVerification.ts` | Reused unchanged by admin-created accounts. |

### Missing, and this plan builds it

| Gap | Consequence today | Covered by |
|---|---|---|
| No credential update of any kind | `CredentialWriteRepository` has only `exists` and `create`. No password can ever be changed. | [`02`](./02-credential-lifecycle.md) |
| No password reset | A client who forgets their password has no recovery path at all. | [`02`](./02-credential-lifecycle.md) |
| No admin account creation | Every client must self-signup. | [`03`](./03-admin-created-clients.md) |
| No way to record a pre-app investment | Legacy clients show a zero portfolio. | [`04`](./04-recorded-contributions.md) |
| No admin read of a client position | The growth commit endpoint exists but a UI has nothing to render first. | [`05`](./05-per-client-growth.md) |
| No admin growth UI | `grep -rn "clientGrowth" frontend_stack_ts/src` returns nothing. | [`05`](./05-per-client-growth.md) |
| No reversal writer | No admin money write can be undone. | [`04`](./04-recorded-contributions.md) §6 |

## 4. Conventions any new code must follow

Gathered from the existing admin modules; these are house style, not suggestions.

**Backend routes.** A route module per area, registered in `runtime/composition.ts`. Zod schemas
validated with `parseOrThrow`. Errors from the catalogue in `http/errorCatalog.ts` as
`AppError("CODE")` — never ad-hoc messages. Money-mutating admin routes go through
`runAdminMutation` for idempotency and audit.

**Authorisation.** `resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })` then
`requireAnyPermission(principal, ["some.permission"])`. Permissions are checked live per request,
not baked into a token.

**Repositories.** Thin, `Transaction`-taking functions. Optimistic concurrency via `version`
columns; row locks via explicit `lockX` methods before read-modify-write.

**Frontend.** Admin screens are declared in `frontend_stack_ts/src/app/routing/adminRoutes.ts`.
`routeIntegrity.test.ts` enforces the route manifest and the link map, **including reachability** —
a new screen that nothing links to fails the test.

**Money.** See [`00-constraints.md`](./00-constraints.md) §9.

**Migrations.** Numbered SQL files under `backend_controller/db/migrations/`, idempotent enum
creation via the `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;` pattern.
Applied before the code that depends on them — see
[`06-sequencing-and-migrations.md`](./06-sequencing-and-migrations.md).

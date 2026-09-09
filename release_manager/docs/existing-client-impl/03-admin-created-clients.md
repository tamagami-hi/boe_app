# Feature A — admin-created client accounts

An admin creates a client account directly, without a landing-page signup. The client still
verifies their email before investing.

**Depends on** [`02-credential-lifecycle.md`](./02-credential-lifecycle.md).

---

## 1. Scope

One endpoint, one transaction:

```
POST /v1/admin/clients        permission: clients.create
```

In a single transaction:

1. Insert the `users` row with `account_state = 'active'`.
2. Issue an email verification, reusing `domain/client/emailVerification.ts` unchanged.
3. Issue a **set-password** token ([`02`](./02-credential-lifecycle.md) §2) and queue the invite
   email through the outbox.
4. Append an audit row.

No credential row is created. The client sets their own password, so no human other than the client
ever knows it.

## 2. What is deliberately not done

**No `applications` row.** Approval is a decision *about an application*; there is no application
here. Manufacturing one to satisfy a foreign key would put fabricated review records into the
approval audit trail, which is precisely the record you would later rely on to prove who approved
whom.

**No credential set by the admin.** Considered and rejected: an admin-typed temporary password is
cheapest, but a human learns the client's password and it needs a forced-change-on-first-login flag
that does not exist.

**No reuse of `decideApplication`.** Considered and rejected: least new code, but it writes the
fabricated application and review rows described above.

**No email-verified shortcut.** See §4.

## 3. Email verification before investing — free

No new gate, no new code. Because eligibility is derived
([`00-constraints.md`](./00-constraints.md) §1) from `account_state = 'active'` **and** a `verified`
email verification, and because the investing command re-derives it under lock, an admin-created
account is automatically `pending_verification` until the client verifies.

The client app already routes on this through its `access: "eligible"` route flag, so the existing
"verify your email" surface appears with no frontend work.

The useful consequence: **an admin cannot create an account that can invest immediately, even by
mistake.**

## 4. Invariants this feature must not break

| Invariant | Why it matters |
|---|---|
| `account_state` is `'active'` | Anything else derives to `blocked` and the client cannot use the app. |
| No admin override on email verification | It would make `deriveInvestingEligibility` a liar and move the money gate under admin control. |
| Email uniqueness across `users` **and** pending `applications` | Otherwise an admin can create an account that collides with an in-flight signup, and the approval of that signup then fails or duplicates the person. |
| The set-password token does not verify the email | [`02`](./02-credential-lifecycle.md) §7. |

The email-uniqueness one is the easiest to get wrong: checking only `users` looks correct and passes
every test until a real collision happens.

## 5. Request shape

Mirror what the signup application collects, minus the password. The exact field list should be
taken from `publicOnboardingRoutes.ts` at implementation time so the two paths produce
indistinguishable accounts — if the admin path collects less, admin-created clients become
second-class rows that later reports have to special-case.

Validate with a zod schema and `parseOrThrow`. Normalise the email the same way the signup path
does, or uniqueness checks will disagree with themselves.

## 6. Work items

1. Migration: the `clients.create` permission row, and whatever grant seeds it to the admin role.
2. `routes/adminClientOnboardingRoutes.ts`, registered in `runtime/composition.ts`, following the
   `adminAumRoutes.ts` shape and wrapped in `runAdminMutation`.
3. `domain/admin/createClientAccount.ts` — the transaction body: user insert, email verification,
   set-password token, audit.
4. Email template for the invite, distinct from the reset template.
5. Admin console: a "create client" form. Natural home is alongside the client-detail screen built
   in [`05-per-client-growth.md`](./05-per-client-growth.md), so consider sequencing this after C
   if the admin console has no client-list screen yet — see
   [`08-evidence.md`](./08-evidence.md) for what is unknown there.

## 7. Tests required

- A created account derives to `pending_verification`, not `eligible`.
- After the client verifies, it derives to `eligible`.
- An investing attempt before verification is refused **by the investing command**, not merely
  hidden by the UI.
- Duplicate email is refused when the address exists in `users`.
- Duplicate email is refused when the address exists in a **pending application**.
- No credential row exists immediately after creation.
- The set-password token is issued and the invite is queued to the outbox.
- Audit row records which admin created the account.
- Missing the `clients.create` permission is refused.

## 8. Definition of done

An admin can create an account for a client who never visited the landing page; that client
receives one email, sets their own password, verifies their address, and can then invest — and at
no point could the admin have made the account investable without the client's participation.

## 9. Risks

**Divergent account shapes.** If the admin path collects a different field set from the signup path,
you get two populations of client rows and every downstream report has to know about both. Take the
field list from the signup route (§5).

**Silent uniqueness hole.** See §4.

**Invite email deliverability.** The account is unusable until the invite arrives. Because the token
is one-active-per-user, a re-send is safe — make sure the admin console offers one, or a bounced
email means a stuck account with no operator remedy.

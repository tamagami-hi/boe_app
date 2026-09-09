# Feature D — credential lifecycle: set, reset, change

**Build first.** Feature A depends on it, and it closes a live gap: today no password can be
changed and a client who forgets one has no recovery path.

---

## 1. Scope

One primitive — a single-use, expiring, hashed token that authorises exactly one credential write —
behind three entry points:

| Flow | Started by | Proof of identity | Token needed |
|---|---|---|---|
| **Set** (invite) | admin creates the account ([`03`](./03-admin-created-clients.md)) | possession of the emailed token | yes |
| **Reset** (forgot) | the client, by email address | possession of the emailed token | yes |
| **Change** | the signed-in client | current password + live session | no |

Set and reset are the same code path with different triggers. Change is separate: the session plus
the current password is already sufficient proof, so issuing a token would add risk, not remove it.

## 2. Mirror the email-verification design

`email_verification_codes` (`db/migrations/040_email_verification_schema.sql:11`) is the precedent:

```sql
CREATE TABLE email_verification_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  code_hash bytea NOT NULL,
  code_key_version text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_verification_codes_hash_len CHECK (octet_length(code_hash) = 32),
  CONSTRAINT email_verification_codes_key_version CHECK (btrim(code_key_version) <> ''),
  CONSTRAINT email_verification_codes_attempts CHECK (attempt_count >= 0),
  CONSTRAINT email_verification_codes_expiry CHECK (expires_at > created_at) );

CREATE UNIQUE INDEX email_verification_codes_active_user_uk
  ON email_verification_codes (user_id) WHERE consumed_at IS NULL;
```

Properties to carry over **verbatim**, each for a reason:

- `code_hash` + `code_key_version` — the token is never stored in the clear, and keys can rotate
  without invalidating the schema.
- `octet_length(code_hash) = 32` — the database refuses a truncated or wrong-algorithm hash.
- `attempt_count` — caps brute force per token.
- `expires_at` / `consumed_at` — expiry and single use.
- The partial unique index — **at most one active token per user**, so requesting a new one
  implicitly retires the old. This is what stops an attacker keeping a stale token alive by
  spamming requests.

Copy the consume discipline from `domain/client/emailVerification.ts` too: lock the active row,
check expiry, check the attempt cap, compare with the constant-time `bytesEqual`, increment
attempts on mismatch, consume only on success. Return a discriminated union rather than throwing,
so the route maps outcomes to responses.

## 3. One deliberate deviation: token entropy

Email verification uses a **6-character** code. That is appropriate there — attempt-capped,
short-lived, and the prize is proving you own a mailbox.

For password reset the prize is **full account takeover**. Use a high-entropy opaque token
delivered in a link. This needs no new crypto: `crypto.generateVerificationToken()`
(`crypto/context.ts:88`) already returns `{ token, hash, keyVersion }` over `generateOpaqueToken()`
and is already used elsewhere in onboarding.

Keep the attempt cap regardless — it costs nothing and defends against a hash-collision or
key-compromise scenario nobody planned for.

## 4. Endpoints

```
POST /v1/auth/password/forgot   { email }                          -> 202 always
POST /v1/auth/password/reset    { token, newPassword }             -> 204
POST /v1/auth/password/change   { currentPassword, newPassword }   -> 204   (session + CSRF)
```

### `forgot` must not become an enumeration oracle

It must answer **202 with an identical body** whether or not the address exists, and with
comparable timing. Two specific traps:

- Do not skip the work when the user is absent — an attacker can time the difference. Do the same
  hashing work regardless.
- **Do not let the rate limiter leak.** A per-email cooldown that returns `RATE_LIMITED` for
  existing addresses and `202` for unknown ones is an oracle in disguise. Either apply the cooldown
  uniformly, or key it so that its response is indistinguishable.

The existing cooldown pattern is `AppError("RATE_LIMITED", { retryAfterSeconds })` in
`emailVerification.ts` — reuse the shape, but check the leak above before reusing it literally on
this endpoint.

Delivery goes through the existing outbox and email worker, the same path email verification uses.

## 5. Two things that must happen on every credential write

Applies to all three flows.

**Revoke every existing session.** A reset means the client suspected compromise, or an admin just
handed over an account. Stale refresh tokens must not survive either case.
`authSessionRepository.revokeAllForUser(tx, { userId, reason, now })` (`:125`) already exists and
returns `revokedSessionCount` / `revokedRefreshTokenCount`. Call it **in the same transaction** as
the credential write and put the counts in the audit metadata.

**Append an audit row.** Follow the `email_verification.*` naming already in use:

```
password.reset_requested     actor: user (or none, if the address was unknown)
password.reset_completed     actor: user
password.changed             actor: user
password.set_by_invite       actor: user, metadata: created by which admin
```

Never log the token or the password, hashed or otherwise.

## 6. The repository gap

`CredentialWriteRepository` (`repositories/credentialRepository.ts:10`) is currently:

```ts
exists: (tx, userId) => Promise<boolean>
create: (tx, userId, argon2idHash) => Promise<UserCredential>
```

It needs a `replace` taking a new argon2id hash, with the same key discipline as `create`.

Whether the superseded hash is kept as history or overwritten in place is
[decision D-3](./07-open-decisions.md). In-place is simpler and credentials are not money;
history would let you detect password reuse, which nothing currently asks for.

## 7. Do not couple the token to email verification

A set-password token proves control of the mailbox, since that is where it was sent. It is
therefore tempting to mark the email verified when it is consumed.

**Do not.** Eligibility is derived from the email-verification record specifically
([`00-constraints.md`](./00-constraints.md) §1). Satisfying that as a side effect of a credential
flow would put the money gate behind a password flow, and make the derivation depend on history
rather than state. Keep them independent, even at the cost of the client completing two steps.

## 8. Work items

1. Migration: `password_credential_tokens` table, modelled on §2, with a `purpose` column
   distinguishing `set` from `reset` (both consume identically; the distinction is for audit and
   for choosing the email template).
2. `repositories/passwordTokenRepository.ts` — create, lock-active, consume, increment-attempt,
   latest-created-at (for the cooldown).
3. `repositories/credentialRepository.ts` — add `replace`.
4. `domain/auth/passwordCredential.ts` — the three flows as pure-ish domain functions returning
   discriminated unions, mirroring `emailVerification.ts`.
5. `routes/passwordRoutes.ts` — the three endpoints, registered in `runtime/composition.ts`.
6. Email templates for invite and reset, wired through the outbox.
7. Client app: a set/reset password screen. Whether the link opens the app or the web is
   [decision D-4](./07-open-decisions.md).
8. A change-password surface in the client app's existing security screen.

## 9. Tests required

- Token consume: happy path; expired; attempt cap reached; wrong token; already consumed; second
  request retires the first.
- `forgot` returns byte-identical responses for a known and an unknown address, including headers.
- Rate limiting does not distinguish known from unknown addresses.
- Sessions are revoked on reset and on change, asserted via the returned counts.
- `change` rejects a wrong current password and does not revoke sessions when it rejects.
- Audit rows are appended with the right command and never contain the token or password.
- Consuming a set-password token does **not** mark the email verified (§7).

## 10. Definition of done

An admin-created account can be activated by its owner without any human learning the password; a
client who forgets their password can recover it unaided; a signed-in client can change it; and in
all three cases every previously issued session is dead.

## 11. Dependencies and risks

**Depends on:** nothing. This is the leaf, which is why it is first.

**Blocks:** [`03-admin-created-clients.md`](./03-admin-created-clients.md).

**Risk — enumeration.** The most likely defect is a `forgot` endpoint that leaks account existence
through timing, status code, or the rate limiter. Test it explicitly (§9).

**Risk — the reset link is a bearer credential.** It will sit in the client's mailbox
indefinitely. Short expiry, single use, and one-active-per-user (§2) are the mitigations; do not
relax any of them for convenience.

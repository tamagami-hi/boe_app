# PostgreSQL Schema and Lifecycle Specification

## 1. Purpose and invariants

This is the implementation contract for the additive PostgreSQL rearchitecture.
The first deployable slice is public application submission through email
verification, admin decision, activation, and web/native authentication. Later
tables are specified far enough to prevent the first slice from creating a
second identity, catalog, ownership, payment, or audit model.

The schema has these non-negotiable invariants:

- PostgreSQL is the only durable store; only the backend connects to it.
- UUID primary keys use `gen_random_uuid()`. All timestamps are `timestamptz`
  in UTC and all mutable aggregate roots carry `version bigint NOT NULL DEFAULT
  1` for optimistic concurrency.
- INR amounts are integer paise in `bigint`. NAV, units, and allocation values
  use `numeric(24,8)`. TypeScript exposes both as strings or domain decimal
  values, never JavaScript `number`.
- Normalized emails are lowercase and trimmed. Phones are E.164. Raw bearer,
  refresh, verification, and activation tokens are never persisted.
- Client-owned child rows repeat `user_id` and enforce ownership with composite
  foreign keys. Repositories always include `user_id` in client queries.
- Aggregate rows are updated only through guarded commands. Every successful
  state change appends an `audit_events` row in the same transaction.
- Evidence and financial-result rows are append-only. Corrections are new
  events or reversal records, never updates or deletes.
- Investing eligibility is derived at read/command time. There is no MVP
  eligibility table or eligibility status column.
- Public submission and verification responses expose status/next-step data but
  never an application UUID. Application IDs are visible only to authorized
  admin routes; public continuation relies on single-use token possession.

Enable `pgcrypto`. Use native PostgreSQL enums for the closed state sets below;
all other bounded labels use checks so they can evolve through normal
migrations.

## 2. Canonical types and derived eligibility

### 2.1 State enums

| Type | Values |
| --- | --- |
| `application_state` | `pending_email_verification`, `submitted`, `in_review`, `approved`, `rejected`, `withdrawn` |
| `user_account_state` | `invited`, `active`, `suspended`, `closed` |
| `activation_invite_state` | `pending`, `accepted`, `revoked` |
| `email_delivery_state` | `queued`, `sending`, `sent`, `delivered`, `retryable_failed`, `permanent_failed`, `cancelled` |
| `auth_session_state` | `active`, `revoked`, `expired` |
| `kyc_case_state` | `pending_submission`, `submitted`, `in_review`, `approved`, `rejected`, `needs_information` |
| `risk_assessment_state` | `not_started`, `submitted`, `assessed` |
| `fund_state` | `draft`, `review_pending`, `published`, `paused`, `archived` |
| `sip_state` | `draft`, `pending_mandate`, `active`, `paused`, `cancelled`, `completed` |
| `order_state` | `submitted`, `payment_pending`, `payment_confirmed`, `booked`, `payment_failed`, `cancelled`, `rejected`, `refunded`, `reversed` |
| `payment_state` | `created`, `provider_pending`, `succeeded`, `failed`, `expired`, `refunded` |
| `mandate_state` | `created`, `pending_user_authorization`, `active`, `paused`, `revoked`, `failed`, `expired` |
| `redemption_state` | `submitted`, `units_reserved`, `approved`, `settlement_pending`, `settled`, `rejected`, `cancelled` |
| `provider_event_state` | `received`, `processing`, `processed`, `dead_lettered` |
| `outbox_state` | `pending`, `processing`, `sending`, `delivered`, `retryable_failed`, `dead_lettered`, `cancelled` |

### 2.2 Other closed enums

- `actor_type`: `public`, `user`, `admin`, `system`, `provider`.
- `application_decision`: `approved`, `rejected`.
- `token_purpose`: `application_email_verification`, `password_reset`.
- `session_channel`: `native`, `web`.
- `risk_category`: `conservative`, `balanced`, `growth`, `aggressive`.
- `fund_risk_level`: `low`, `moderate`, `high`, `very_high`.
- `order_type`: `purchase`, `sip_installment`, `redemption`, `refund`, `adjustment`.
- `execution_type`: `allotment`, `redemption`, `refund`, `reversal`, `adjustment`.
- `approval_state`: `pending`, `approved`, `rejected`, `executed`, `stale`,
  `expired`.

### 2.3 Derived investing eligibility

Return a domain value, but do not store it:

```text
closed or suspended user                         -> suspended
user.account_state <> active                     -> blocked
no KYC case, or KYC not approved                 -> pending_compliance
no risk assessment, or risk not assessed         -> pending_compliance
approved KYC has expired                         -> pending_compliance
active user + current approved KYC + assessed risk -> eligible
```

The command must lock/re-read the user, latest KYC case, and latest risk
assessment before accepting an investment. `eligible` is not cached in
configuration, JWT claims, or a client-owned row.

## 3. First-slice schema

The notation below is normative: every listed column, constraint, index, and
delete action must appear in the target migration. Unlisted nullable columns
must not be added to the first slice.

### 3.1 Applications and verification

#### `applications`

| Column | Definition |
| --- | --- |
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `email_normalized` | `text NOT NULL` |
| `phone_e164` | `text NOT NULL` |
| `full_name` | `text NOT NULL` |
| `state` | `application_state NOT NULL DEFAULT 'pending_email_verification'` |
| `email_verified_at` | `timestamptz NULL` |
| `submitted_at` | `timestamptz NULL` |
| `review_started_at` | `timestamptz NULL` |
| `decided_at` | `timestamptz NULL` |
| `withdrawn_at` | `timestamptz NULL` |
| `pii_tombstoned_at` | `timestamptz NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` |
| `version` | `bigint NOT NULL DEFAULT 1` |

Checks: while `pii_tombstoned_at IS NULL`, email equals
`lower(btrim(email_normalized))`, contains one `@`, and is at most 254
characters; phone matches `^\+[1-9][0-9]{7,14}$`; and trimmed `full_name` is
2-120 Unicode code points with no C0/C1 controls. After tombstoning, fields are
exact deterministic non-secret markers derived from row ID:
`tombstone+<uuid-without-hyphens>@invalid.example`, `tombstone:<uuid>`, and
`Tombstoned`; the timestamp is set in the same update. `version > 0`; state
timestamps must be present once their state is reached. Create unique partial indexes on `email_normalized` and on
`phone_e164` for states other than `rejected` and `withdrawn`. Create the admin
queue indexes `(state, created_at DESC, id DESC)` and `(created_at DESC, id
DESC)` so both filtered and unfiltered queries implement the API's exact
`createdAt DESC, applicationId DESC` keyset order.

Delete policy: `RESTRICT`; pseudonymized applications/evidence are retained for
seven years after decision/withdrawal, after submission when never decided, or
after creation when never verified. Direct PII on an unverified application is replaced by unique,
non-reversible tombstones 30 days after `created_at`. Withdrawn or rejected
application PII is tombstoned 180 days after `withdrawn_at` or `decided_at`.
An approved application's direct PII is tombstoned with its linked closed user
180 days after `users.closed_at`. Both rows replace normalized identifiers with
unique non-reversible tombstones so the original email and phone can be reused.
State and pseudonymized consent, review, and audit evidence remain for their
seven-year evidence period. An active legal hold suspends either operation.

#### `application_details` (postponed)

This is a later-slice one-to-one extension point. It is not created, read, or
written by any first-slice route and is explicitly excluded from the
first-slice submission transaction and acceptance criteria.

| Column | Definition |
| --- | --- |
| `application_id` | `uuid PRIMARY KEY REFERENCES applications(id) ON DELETE RESTRICT` |
| `source` | `text NOT NULL DEFAULT 'landing'` |
| `referral_code` | `text NULL` |
| `answers` | `jsonb NOT NULL DEFAULT '{}'::jsonb` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` |

Checks: source is nonblank and at most 64 characters; `answers` is an object.
Answers are boundary-validated against a versioned schema before insertion and
must contain no credentials, government identifiers, or file bodies.

#### `consent_documents`

| Column | Definition |
| --- | --- |
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `kind` | `text NOT NULL` |
| `version` | `text NOT NULL` |
| `public_path` | `text NOT NULL` |
| `content_markdown` | `text NOT NULL` |
| `content_sha256` | `bytea NOT NULL` |
| `published_at` | `timestamptz NOT NULL` |
| `retired_at` | `timestamptz NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

Unique `(kind, version)`, unique `public_path`, and one current document per
kind via partial unique index `(kind) WHERE retired_at IS NULL`. Checks permit
first-slice kinds only `terms` and `privacy`, require version to match
`^[A-Za-z0-9._-]{1,40}$`, require `public_path` to be the canonical
root-relative site-path form in `04` (including uppercase percent escapes and
the protocol-relative/dot-segment/encoded-separator exclusions), require
nonblank Markdown, require a 32-byte digest equal to
SHA-256 of the UTF-8 bytes of `content_markdown`, and require retirement after
publication. Publication boundary validation enforces the safe Markdown subset
in `04`: raw HTML/images/active content are forbidden and link schemes are
limited to same-origin paths, HTTPS, and mailto. The path, Markdown, and digest are immutable; retiring a document
sets `retired_at` and publishes a new row/version. Retain indefinitely as the
authoritative consent text and digest history.

#### `application_consents`

| Column | Definition |
| --- | --- |
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `application_id` | `uuid NOT NULL REFERENCES applications(id) ON DELETE RESTRICT` |
| `consent_document_id` | `uuid NOT NULL REFERENCES consent_documents(id) ON DELETE RESTRICT` |
| `accepted_at` | `timestamptz NOT NULL` |
| `ip_hmac` | `bytea NOT NULL` |
| `ip_hmac_key_version` | `text NOT NULL` |
| `user_agent` | `text NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

Unique `(application_id, consent_document_id)`. Check
`octet_length(ip_hmac) = 32`, require a nonblank key version, and when present
require `user_agent` to be at most 512 UTF-8 bytes with no C0/C1 control
characters; the request IP
itself is never persisted. Index
`(application_id, accepted_at DESC)`. Submission must reference exactly one
current `terms` and one current `privacy` document. Rows are append-only and
retained with the application for seven years after `applications.decided_at`,
seven years after `withdrawn_at`/`submitted_at` when no decision exists, or
seven years after application `created_at` when it was never verified.

#### `verification_tokens`

| Column | Definition |
| --- | --- |
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `application_id` | `uuid NULL REFERENCES applications(id) ON DELETE RESTRICT` |
| `user_id` | `uuid NULL REFERENCES users(id) ON DELETE RESTRICT` |
| `purpose` | `token_purpose NOT NULL` |
| `token_hash` | `bytea NOT NULL` |
| `token_key_version` | `text NOT NULL` |
| `expires_at` | `timestamptz NOT NULL` |
| `consumed_at` | `timestamptz NULL` |
| `revoked_at` | `timestamptz NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

Exactly one subject is non-null; application verification requires
`application_id`, while password reset requires `user_id`. Unique
`token_hash`; one pending application-verification token via partial unique
index `(application_id, purpose) WHERE consumed_at IS NULL AND revoked_at IS
NULL`; index `(expires_at) WHERE consumed_at IS NULL AND revoked_at IS NULL`.
Add unique `(id, application_id)` for subject-safe delivery ownership.
Checks require a 32-byte SHA-256 hash, nonblank token key version,
`expires_at > created_at`, and not both consumed and revoked. A raw token is
deterministically derived from the token row ID and versioned server key for
delivery retries, but is never stored. Delete 90 days after the latest of
`consumed_at`, `revoked_at`, or `expires_at`, after audit retention has captured
the outcome.

#### `application_reviews`

| Column | Definition |
| --- | --- |
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `application_id` | `uuid NOT NULL REFERENCES applications(id) ON DELETE RESTRICT` |
| `reviewer_user_id` | `uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT` |
| `decision` | `application_decision NOT NULL` |
| `reason_code` | `text NOT NULL` |
| `reason_detail` | `text NULL` |
| `request_id` | `uuid NOT NULL` |
| `idempotency_key` | `text NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

Unique `application_id` and unique `(reviewer_user_id, idempotency_key)`.
Checks require nonblank reason code and a reason detail of at most 2,000
characters. Index `(reviewer_user_id, created_at DESC)`. Append-only; retain
seven years. Ordinary onboarding decisions do not use maker-checker approval.

### 3.2 Identity, activation, and sessions

#### `users`

| Column | Definition |
| --- | --- |
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `application_id` | `uuid NULL REFERENCES applications(id) ON DELETE RESTRICT` |
| `email_normalized` | `text NOT NULL` |
| `phone_e164` | `text NOT NULL` |
| `full_name` | `text NOT NULL` |
| `account_state` | `user_account_state NOT NULL DEFAULT 'invited'` |
| `activated_at` | `timestamptz NULL` |
| `suspended_at` | `timestamptz NULL` |
| `closed_at` | `timestamptz NULL` |
| `pii_tombstoned_at` | `timestamptz NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` |
| `version` | `bigint NOT NULL DEFAULT 1` |

Unique `application_id` where non-null, unique `email_normalized`, unique
`phone_e164`, and unique `(id, application_id)` for invite ownership. Reuse the
application live/tombstone normalization/name checks and exact ID-derived
markers.
Require `activated_at` for `active`/`suspended`/`closed`, `suspended_at` for
`suspended`, and `closed_at` for `closed`. Index `(account_state, created_at)`.
No username, password, role, KYC, risk, approval, or eligibility column.

Delete policy: never cascade from application and never physically delete a
user with financial, compliance, consent, or audit evidence. Closing revokes
sessions and erases the credential hash in the same transaction. Unless an
active legal hold applies, replace direct name/email/phone with unique,
non-reversible tombstones 180 days after `closed_at`; retain the stable user ID
only as the pseudonymous evidence link required by consent, audit, compliance,
and financial records. The same bounded transaction tombstones direct PII on
the linked approved application unless an applicable application/user hold is
active, making the original normalized identifiers reusable.

#### `user_credentials`

| Column | Definition |
| --- | --- |
| `user_id` | `uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT` |
| `password_hash` | `text NULL` |
| `password_changed_at` | `timestamptz NOT NULL DEFAULT now()` |
| `failed_attempt_count` | `integer NOT NULL DEFAULT 0` |
| `failed_attempt_window_started_at` | `timestamptz NULL` |
| `locked_until` | `timestamptz NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` |
| `version` | `bigint NOT NULL DEFAULT 1` |

Checks: a non-null hash begins with the configured Argon2id encoded-hash
prefix, failed attempts are nonnegative, a positive count has a window start,
a zero count has no window start, and version is positive. A null hash
is valid only after account closure: `closeUser` sets `password_hash = NULL`
and revokes sessions/invites in the same transaction that changes the user to
`closed`. Password hashes never enter logs, audit snapshots, API payloads,
analytics, or backups outside encrypted database backups.

Login locks the credential row before changing counters. When not already
locked, the first failed password check starts a 15-minute failure window. A
failure inside that window increments `failed_attempt_count`; the fifth failure
inside the window sets `locked_until = database now() + interval '15 minutes'`.
A failure after the window expires clears the old count/window and becomes
failure one of a new window. While locked, attempts do not extend the lock or change the counter;
the service still performs a bounded dummy Argon2id verification and returns the
same generic `401 INVALID_CREDENTIALS` response and timing class as an unknown
identifier or wrong password. A successful login resets the count/window to
zero/null and clears `locked_until` atomically with session creation. On the
first failed attempt after lock expiry, clear the expired lock/count/window
first, then record that attempt as failure one of a new 15-minute window.
No response reveals whether the account exists, is locked, or which credential
check failed.

#### `activation_invites`

| Column | Definition |
| --- | --- |
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `user_id` | `uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT` |
| `application_id` | `uuid NOT NULL REFERENCES applications(id) ON DELETE RESTRICT` |
| `token_hash` | `bytea NOT NULL` |
| `token_key_version` | `text NOT NULL` |
| `state` | `activation_invite_state NOT NULL DEFAULT 'pending'` |
| `expires_at` | `timestamptz NOT NULL` |
| `accepted_at` | `timestamptz NULL` |
| `revoked_at` | `timestamptz NULL` |
| `revocation_reason` | `text NULL` |
| `created_by_user_id` | `uuid NULL REFERENCES users(id) ON DELETE RESTRICT` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `version` | `bigint NOT NULL DEFAULT 1` |

Add composite FK `(user_id, application_id) -> users(id, application_id)` and
therefore unique `users(id, application_id)`. Unique `token_hash`; one pending
invite per user with partial unique index `(user_id) WHERE state = 'pending'`;
add unique `(id, user_id)` for subject-safe delivery ownership; index
`(expires_at) WHERE state = 'pending'`. Require 32-byte hash, nonblank key
version, expiry after creation, accepted timestamp only for accepted state, and
revoked timestamp and reason only for revoked state. The same versioned-key
derivation rule as verification tokens makes retry links reproducible without
storing raw tokens. Retain seven years after the latest of acceptance,
revocation, or expiry as activation evidence.

#### `auth_sessions`

| Column | Definition |
| --- | --- |
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `user_id` | `uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT` |
| `token_family_id` | `uuid NOT NULL DEFAULT gen_random_uuid()` |
| `channel` | `session_channel NOT NULL` |
| `device_id_hash` | `bytea NULL` |
| `state` | `auth_session_state NOT NULL DEFAULT 'active'` |
| `generation` | `bigint NOT NULL DEFAULT 0` |
| `refresh_key_version` | `text NOT NULL` |
| `previous_refresh_token_hash` | `bytea NULL` |
| `previous_refresh_key_version` | `text NULL` |
| `previous_refresh_valid_until` | `timestamptz NULL` |
| `last_rotation_id` | `uuid NULL` |
| `csrf_token_hash` | `bytea NULL` |
| `csrf_key_version` | `text NULL` |
| `previous_csrf_token_hash` | `bytea NULL` |
| `previous_csrf_key_version` | `text NULL` |
| `previous_csrf_valid_until` | `timestamptz NULL` |
| `csrf_expires_at` | `timestamptz NULL` |
| `csrf_rotated_at` | `timestamptz NULL` |
| `ip_address` | `inet NULL` |
| `user_agent` | `text NULL` |
| `last_seen_at` | `timestamptz NOT NULL DEFAULT now()` |
| `expires_at` | `timestamptz NOT NULL` |
| `revoked_at` | `timestamptz NULL` |
| `revocation_reason` | `text NULL` |
| `expired_at` | `timestamptz NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` |
| `version` | `bigint NOT NULL DEFAULT 1` |

Unique `token_family_id`, unique `(id, user_id)`, and one active native session
per device via `(user_id, device_id_hash) WHERE channel = 'native' AND state =
'active' AND device_id_hash IS NOT NULL`. Index active expiry and
`(user_id, created_at DESC)`. Device hashes are 32 bytes. Generation is
nonnegative; refresh key version is nonblank. `last_rotation_id` is null before
the first refresh and thereafter contains the client-provided rotation ID; it
is never generated by the server. Previous refresh hash, previous key version,
and validity are either all null or contain a 32-byte hash, nonblank key ID, and
a validity exactly 30 seconds after the successful rotation's database time.
CSRF fields are all null for native sessions. Web sessions have a 32-byte
current CSRF hash and nonblank current key version. Their previous CSRF hash,
previous key version, and validity are either all null or contain a 32-byte
hash, nonblank key ID, and the same 30-second boundary as the previous refresh.
`csrf_rotated_at` is database rotation time and `csrf_expires_at` is the
corresponding 10-minute access-token expiry. When present, `user_agent` is at
most 512 UTF-8 bytes and contains no C0/C1 control characters. Expiry follows
creation and terminal state timestamps/reasons match
their state. Retain terminal session metadata 180 days after `revoked_at` or
`expired_at`, then delete it and its refresh-token rows.

#### `auth_refresh_tokens`

| Column | Definition |
| --- | --- |
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `session_id` | `uuid NOT NULL` |
| `user_id` | `uuid NOT NULL` |
| `generation` | `bigint NOT NULL` |
| `token_hash` | `bytea NOT NULL` |
| `token_key_version` | `text NOT NULL` |
| `expires_at` | `timestamptz NOT NULL` |
| `used_at` | `timestamptz NULL` |
| `revoked_at` | `timestamptz NULL` |
| `replaced_by_token_id` | `uuid NULL REFERENCES auth_refresh_tokens(id) ON DELETE RESTRICT` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

Composite FK `(session_id, user_id) -> auth_sessions(id, user_id) ON DELETE
CASCADE`. Unique
`token_hash`, unique `(session_id, generation)`, and one current token via
partial unique `(session_id) WHERE used_at IS NULL AND revoked_at IS NULL`.
Checks require a 32-byte hash, nonblank token key version, nonnegative generation, expiry after creation,
and no simultaneous used/revoked timestamps. Index unexpired token hashes and
`(session_id, created_at DESC)`. A used token is retained until session cleanup
so replay can revoke the family.

### 3.3 RBAC, audit, idempotency, and delivery

#### RBAC tables

- `roles(id uuid PK, code text UNIQUE NOT NULL, name text NOT NULL, created_at
  timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT
  now(), version bigint NOT NULL DEFAULT 1)`; code is lowercase snake case. Seed
  `superadmin`, `onboarding`, `finance`, `content`, `support`; version is
  positive and increments with each approved permission-mapping change.
- `permissions(id uuid PK, code text UNIQUE NOT NULL, description text NOT
  NULL, created_at timestamptz NOT NULL DEFAULT now())`; code is a nonblank
  `domain.action` label.
- `role_permissions(role_id uuid REFERENCES roles ON DELETE RESTRICT,
  permission_id uuid REFERENCES permissions ON DELETE RESTRICT,
  granted_by_user_id uuid REFERENCES users ON DELETE RESTRICT, granted_at
  timestamptz NOT NULL DEFAULT now(), revoked_by_user_id uuid NULL REFERENCES
  users ON DELETE RESTRICT, revoked_at timestamptz NULL, PRIMARY KEY(role_id,
  permission_id, granted_at))`; partial unique `(role_id, permission_id) WHERE
  revoked_at IS NULL`.
- `user_roles(user_id uuid REFERENCES users ON DELETE RESTRICT, role_id uuid
  REFERENCES roles ON DELETE RESTRICT, granted_by_user_id uuid REFERENCES users
  ON DELETE RESTRICT, granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_by_user_id uuid NULL REFERENCES users ON DELETE RESTRICT, revoked_at
  timestamptz NULL, PRIMARY KEY(user_id, role_id, granted_at))`; partial unique
  `(user_id, role_id) WHERE revoked_at IS NULL` and index active roles by user.

RBAC records are retained while referenced by audit evidence. Revocation is an
update with an audit event, not deletion. After deterministic bootstrap seeding,
every runtime role grant/revocation and role-permission mapping change executes
through `rbac.permissions.change` maker-checker approval; maker and checker
must be distinct active administrators and the approved payload binds the exact
principal/role/permission delta.
Grant/revoke actor fields are non-null for runtime changes; bootstrap grants
use the documented bootstrap system actor. Each revoked-by/timestamp pair is
all null or all present.

#### `approval_actions`

| Column | Definition |
| --- | --- |
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `action_type` | `text NOT NULL` |
| `target_type` | `text NOT NULL` |
| `target_id` | `uuid NOT NULL` |
| `target_version` | `bigint NOT NULL` |
| `canonical_payload` | `jsonb NOT NULL` |
| `payload_hash` | `bytea NOT NULL` |
| `state` | `approval_state NOT NULL DEFAULT 'pending'` |
| `maker_user_id` | `uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT` |
| `maker_reason` | `text NOT NULL` |
| `checker_user_id` | `uuid NULL REFERENCES users(id) ON DELETE RESTRICT` |
| `checker_reason` | `text NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `approved_at` | `timestamptz NULL` |
| `rejected_at` | `timestamptz NULL` |
| `executed_at` | `timestamptz NULL` |
| `stale_at` | `timestamptz NULL` |
| `expired_at` | `timestamptz NULL` |
| `expires_at` | `timestamptz NOT NULL` |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` |
| `version` | `bigint NOT NULL DEFAULT 1` |

Unique live action `(action_type, target_type, target_id, target_version) WHERE
state IN ('pending','approved')`; index `(state, created_at, id)` over those
states. Target/version are positive, canonical payload is an object, payload
hash is the 32-byte RFC 8785 canonical JSON digest, maker reason is 10-1,000
Unicode code points, maker and checker differ, state timestamps are coherent,
and expiry follows creation. Payload, hash, target, maker, reason, and expiry are
immutable. Approval has no domain effect by itself. Execution locks the action
and target, compares target version and payload hash, then uses a CAS update
`WHERE state = 'approved' AND version = expectedVersion`; it transitions once
to `executed` in the same transaction as the target mutation, audit, and
outbox. A target/version mismatch transitions to `stale`; database time past
expiry transitions to `expired`. Rejected, executed, stale, and expired rows
are terminal. No approval can amend or delete an investment execution;
financial correction creates a new approved reversal execution.

`action_type` is a closed check, not an extensible free-form exception list.
Its only permitted values are `fund.publish_investable_version`,
`fund.resume`, `fund.archive_published`, `fund_nav.correct`,
`fund_aum.correct`, `investment_order.reverse`,
`redemption.approve_above_threshold`, and `rbac.permissions.change`. These map
to the six covered policy categories: investable fund/term publication; resume
or archive of a published fund; published NAV/AUM correction; booked-order
reversal; above-threshold redemption approval; and role/permission grant,
revocation, or mapping changes. No position correction, provider transition,
ordinary onboarding/KYC/risk/content action, refund, mandate, settlement,
account action, or emergency pause may create an approval action. Adding an
action requires a new typed migration and matching lifecycle/policy decision.

#### `audit_events`

| Column | Definition |
| --- | --- |
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `occurred_at` | `timestamptz NOT NULL DEFAULT now()` |
| `actor_type` | `actor_type NOT NULL` |
| `actor_user_id` | `uuid NULL REFERENCES users(id) ON DELETE RESTRICT` |
| `command` | `text NOT NULL` |
| `entity_type` | `text NOT NULL` |
| `entity_id` | `uuid NOT NULL` |
| `from_state` | `text NULL` |
| `to_state` | `text NULL` |
| `reason_code` | `text NULL` |
| `reason_detail` | `text NULL` |
| `request_id` | `uuid NOT NULL` |
| `idempotency_key` | `text NULL` |
| `entity_version` | `bigint NOT NULL` |
| `ip_address` | `inet NULL` |
| `user_agent` | `text NULL` |
| `metadata` | `jsonb NOT NULL DEFAULT '{}'::jsonb` |

Indexes `(entity_type, entity_id, occurred_at DESC, id DESC)`,
`(actor_user_id, occurred_at DESC)`, and `(request_id)`. Checks require nonblank
command/entity type, positive version, object metadata, actor user ID for
user/admin actors, and any `user_agent` to be at most 512 UTF-8 bytes with no
C0/C1 control characters. Revoke `UPDATE` and `DELETE` from the application role.
Retain onboarding/security events seven years and financial events at least ten
years. Metadata is an allowlisted, redacted snapshot: no tokens, hashes,
passwords, PAN/Aadhaar, complete address, provider secrets, or raw payloads.

#### `idempotency_records`

| Column | Definition |
| --- | --- |
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `actor_scope` | `text NOT NULL` |
| `actor_scope_key_version` | `text NULL` |
| `http_method` | `text NOT NULL` |
| `route_template` | `text NOT NULL` |
| `key` | `text NOT NULL` |
| `actor_user_id` | `uuid NULL REFERENCES users(id) ON DELETE RESTRICT` |
| `request_hash` | `bytea NOT NULL` |
| `response_status` | `integer NOT NULL` |
| `response_body` | `jsonb NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `completed_at` | `timestamptz NOT NULL DEFAULT now()` |
| `expires_at` | `timestamptz NOT NULL` |

Unique `(actor_scope, http_method, route_template, key)`; request hash is 32
bytes; method is an uppercase mutation method; response status is 100-599;
response body is an object; completion is not before creation; expiry follows
completion. Index `(expires_at, id)`. The table contains completed responses
only: there is no processing state, lease, or crash-recovery row.

Public actor scopes are HMAC-SHA-256 of the canonical normalized identifier
using a dedicated idempotency-scope key and persist its non-secret key version;
authenticated user scopes are stable user IDs and have a null key version.
During key rotation, compute candidate public scopes for every active/retained
key version, acquire their advisory locks in byte-sorted order, and look up any
candidate before inserting with the current key. Retire an old key only after
all records using it expire. This prevents rotation from creating a second
side effect or encouraging reuse of consent/rate/suppression keys.

`request_hash` is SHA-256 of one length-prefixed canonical byte sequence that
binds, in order: uppercase HTTP method, normalized route template, normalized
concrete path, canonical sorted/percent-encoded query pairs, normalized
`If-Match` value or an explicit null marker, and RFC 8785 canonical JSON request
body (or an explicit empty-body marker). A retry that changes any bound value
is a different hash and therefore `IDEMPOTENCY_KEY_REUSED`; adapters may not
hash only the body or omit path/query/concurrency preconditions.

Before reading or mutating, acquire
`pg_try_advisory_xact_lock(hashtextextended(canonical_scope, 0))`, where
`canonical_scope` length-prefixes actor scope, method, normalized route template,
and key. Failure maps to `409 IDEMPOTENCY_IN_PROGRESS`. While holding the
transaction lock, an existing row with another hash maps to
`409 IDEMPOTENCY_KEY_REUSED`; the same hash replays the row. Otherwise perform
the domain mutation and insert its completed response in the same transaction.
A crash/rollback writes no idempotency row and PostgreSQL releases the advisory
transaction lock. Retain public-application rows until 24 hours after
`completed_at`; retain admin/financial rows until seven days after
`completed_at`; bounded cleanup uses `expires_at`.

#### `rate_limit_windows`

| Column | Definition |
| --- | --- |
| `bucket` | `text NOT NULL` |
| `key_hash` | `bytea NOT NULL` |
| `window_start` | `timestamptz NOT NULL` |
| `count` | `integer NOT NULL` |
| `expires_at` | `timestamptz NOT NULL` |

Primary key `(bucket, key_hash, window_start)`. Checks require a nonblank
bucket, a 32-byte HMAC-SHA-256 key hash, `count > 0`, `expires_at >
window_start`, and a UTC-aligned `window_start` supplied by the validated route
policy. Increment and decision are one statement:

```sql
INSERT INTO rate_limit_windows (bucket, key_hash, window_start, count, expires_at)
VALUES ($1, $2, $3, 1, $4)
ON CONFLICT (bucket, key_hash, window_start)
DO UPDATE SET count = rate_limit_windows.count + 1,
              expires_at = GREATEST(rate_limit_windows.expires_at, EXCLUDED.expires_at)
RETURNING count;
```

The returned count is compared with the typed route/dimension limit; no
read-then-write counter path is permitted. Key hashes use the dedicated
versioned rate-limit HMAC key and a type-prefixed canonical subject, never raw
IP/email/phone/token/session data. Create cleanup index `(expires_at,
bucket, key_hash, window_start)` and delete expired rows in bounded batches
using database time. Rate-limit rows are operational state, not audit evidence.

#### `legal_holds`

| Column | Definition |
| --- | --- |
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `entity_type` | `text NOT NULL` |
| `entity_id` | `uuid NOT NULL` |
| `reason` | `text NOT NULL` |
| `placed_by` | `uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT` |
| `placed_at` | `timestamptz NOT NULL DEFAULT now()` |
| `expires_at` | `timestamptz NULL` |
| `released_by` | `uuid NULL REFERENCES users(id) ON DELETE RESTRICT` |
| `released_at` | `timestamptz NULL` |

Checks require nonblank allowlisted `entity_type`, a 10-2,000-code-point reason,
expiry after placement, release fields both null or both present, and release
not before placement. Create one unreleased hold per entity with partial unique
index `(entity_type, entity_id) WHERE released_at IS NULL`, and index
`(entity_type, entity_id, expires_at) WHERE released_at IS NULL`. A hold is
active exactly when `released_at IS NULL AND (expires_at IS NULL OR expires_at
> now())`; expiration is derived and release is an audited update, never
deletion. The typed allowlist is `application`, `user`, `email_delivery`,
`email_provider_event`, `audit_event`, `investor_profile`, `kyc_case`,
`risk_assessment`, `marketing_lead`, `investment_order`, `payment`, and
`mandate`.
`email_provider_event` permits a direct hold on unmatched reconciliation
evidence that has no delivery parent; additions require a typed migration plus
retention-parent tests.

Parent propagation is explicit. An application hold covers its application
details, consents, reviews, verification tokens, and pre-user email deliveries.
A user hold covers its credential, sessions, refresh tokens, activation invites,
user email deliveries, notifications, linked approved application, investor
profile, KYC cases/documents/reviews, risk assessments, investment orders,
payments, mandates, and their retention children. An investor-profile or
risk-assessment hold covers that exact row. A KYC-case hold covers its documents
and reviews. An investment-order hold covers its executions, holding/lot
movements, payment and provider evidence, audit evidence, and generated
evidence. A payment hold covers its attempts, refunds, provider events, and
audit evidence. A mandate hold covers its attempts and provider events.
Financial provider events with only a user or mandate relationship resolve the
user or mandate as their retention parent. An unconverted marketing-lead hold
locks/protects that lead directly; once converted, its linked application is
the retention parent. An email-provider-event hold also covers any suppression
row whose `source_event_id` references that event.
The child row's cleanup query resolves these parents before deciding eligibility.

Every retention, tombstoning, pseudonymization, ciphertext erasure, and
physical-deletion query must exclude a row when an active hold exists for that
exact entity or its retention-owning parent. The retention worker performs this
anti-join in the same transaction as each bounded batch and rechecks it under
lock before mutation; a metric/audit count records held rows without PII.

Hold placement, hold release, and cleanup share one lock protocol. Each
transaction first locks the typed retention-owning parent row `FOR UPDATE`, then
the exact target row when different, then matching `legal_holds` rows ordered by
ID. Cleanup rechecks the active hold only after these locks and retains them
through its mutation commit. Placement/release retain the same locks through
their insert/update and audit commit. Whichever transaction acquires the parent
lock first wins: a hold committed first blocks cleanup; cleanup committed first
may already have purged eligible fields, and the later hold protects only the
remaining evidence and returns `isAlreadyPurged: true`. A hold never claims to
restore deleted data. Concurrency tests cover both winners.

#### `outbox_events`

| Column | Definition |
| --- | --- |
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `topic` | `text NOT NULL` |
| `event_type` | `text NOT NULL` |
| `event_version` | `integer NOT NULL` |
| `aggregate_type` | `text NOT NULL` |
| `aggregate_id` | `uuid NOT NULL` |
| `occurred_at` | `timestamptz NOT NULL` |
| `request_id` | `uuid NOT NULL` |
| `causation_id` | `uuid NULL` |
| `correlation_id` | `uuid NULL` |
| `deduplication_key` | `text NOT NULL UNIQUE` |
| `payload` | `jsonb NOT NULL` |
| `state` | `outbox_state NOT NULL DEFAULT 'pending'` |
| `attempt_count` | `integer NOT NULL DEFAULT 0` |
| `available_at` | `timestamptz NOT NULL DEFAULT now()` |
| `locked_at` | `timestamptz NULL` |
| `locked_by` | `text NULL` |
| `lease_expires_at` | `timestamptz NULL` |
| `delivered_at` | `timestamptz NULL` |
| `cancelled_at` | `timestamptz NULL` |
| `last_error_code` | `text NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` |

Checks require nonblank topic/event/aggregate labels, positive event version,
object payload, nonnegative attempts, `occurred_at <= created_at`, lease fields
together only while `processing` or email `sending`, `lease_expires_at > locked_at`, and
`cancelled_at` only in `cancelled` state.
`request_id` identifies the originating command, `causation_id` identifies the
immediately causing event/command when one exists, and `correlation_id` is
carried unchanged across one business workflow. Producers must supply the
complete envelope; consumers dispatch on `(event_type, event_version)` and
reject an unsupported version without guessing. Index claimable
work on `(available_at, created_at, id) WHERE state IN ('pending',
'retryable_failed')`, plus expired-lease recovery on `(lease_expires_at, id)
WHERE state IN ('processing', 'sending')`. `outbox_events` is the sole owner of due time, claim,
lease, attempt count, retry schedule, and terminal transport result. Workers
claim bounded batches with `FOR UPDATE SKIP LOCKED`. Before SES, a short
transaction locks the claimed outbox row, delivery, and referenced token/invite,
validates suppression and revocation, increments the attempt, and transitions
the outbox from `processing` to `sending` and delivery to `sending`; it commits before external
I/O. That committed `sending` transition is the point of no return. The worker
then records the outbox result and corresponding email-delivery evidence
atomically in a new transaction. Exponential backoff
with jitter updates `available_at`; after the configured maximum attempts,
transition to `dead_lettered`. Obsolete work revoked before `sending` transitions
to `cancelled` with `last_error_code = 'VERIFICATION_TOKEN_REVOKED'` or
`'ACTIVATION_INVITE_REVOKED'` and never performs external I/O. Revocation after
`sending` cannot recall SES; the email may arrive, but its embedded token is
invalid. Retain delivered/cancelled events 90 days and dead
letters one year.

#### `email_deliveries`

| Column | Definition |
| --- | --- |
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `outbox_event_id` | `uuid NULL UNIQUE REFERENCES outbox_events(id) ON DELETE SET NULL` |
| `application_id` | `uuid NULL REFERENCES applications(id) ON DELETE RESTRICT` |
| `user_id` | `uuid NULL REFERENCES users(id) ON DELETE RESTRICT` |
| `verification_token_id` | `uuid NULL REFERENCES verification_tokens(id) ON DELETE RESTRICT` |
| `activation_invite_id` | `uuid NULL REFERENCES activation_invites(id) ON DELETE RESTRICT` |
| `template_key` | `text NOT NULL` |
| `template_version` | `text NOT NULL` |
| `recipient_ciphertext` | `bytea NULL` |
| `recipient_nonce` | `bytea NULL` |
| `recipient_hmac` | `bytea NOT NULL` |
| `recipient_masked` | `text NOT NULL` |
| `recipient_encryption_key_version` | `text NULL` |
| `suppression_hmac_key_version` | `text NOT NULL` |
| `ses_configuration_set` | `text NOT NULL` |
| `ses_message_id` | `text NULL` |
| `ses_request_id` | `text NULL` |
| `state` | `email_delivery_state NOT NULL DEFAULT 'queued'` |
| `attempt_count` | `integer NOT NULL DEFAULT 0` |
| `last_attempt_at` | `timestamptz NULL` |
| `last_error_code` | `text NULL` |
| `failure_detail_ciphertext` | `bytea NULL` |
| `failure_detail_nonce` | `bytea NULL` |
| `failure_detail_key_version` | `text NULL` |
| `sent_at` | `timestamptz NULL` |
| `delivered_at` | `timestamptz NULL` |
| `bounced_at` | `timestamptz NULL` |
| `complained_at` | `timestamptz NULL` |
| `cancelled_at` | `timestamptz NULL` |
| `erased_at` | `timestamptz NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` |
| `version` | `bigint NOT NULL DEFAULT 1` |

At least one application/user subject is present. Template is exactly
`verify_email`, `activation_invite`, or `application_rejected`; verification
template requires only its verification-token FK, activation template requires
only its invite FK, and rejection template requires both token/invite FKs null.
Add composite FK `(verification_token_id, application_id) ->
verification_tokens(id, application_id)` and composite FK
`(activation_invite_id, user_id) -> activation_invites(id, user_id)` so a
delivery cannot combine a valid token or invite with another subject.
The outbox FK is required while delivery state is `queued`, `sending`, or
`retryable_failed`; it may become null only when the linked terminal transport
row is deleted after its shorter retention. Email evidence remains independently
identified by delivery ID, SES IDs, subject IDs, template version, and audit.
Template/key/configuration labels are nonblank. Recipient HMAC is 32 bytes,
masked recipient contains no complete address, suppression/encryption key
versions are nonblank when their envelope is present, attempt count is 0-8,
SES IDs are at most 512 characters, and sent/delivery/bounce/complaint/
cancellation timestamps are monotonic evidence. `recipient_ciphertext`, its
12-byte nonce, and its encryption key version are all present before erasure
and all null after `erased_at`; failure ciphertext, its 12-byte nonce, and
its key version are all present or all null and are null after erasure. Each
ciphertext includes the 16-byte AES-256-GCM authentication tag. Unique
`ses_message_id` where non-null. Index `(state, created_at DESC, id DESC)` for
admin and subject history indexes; there is no delivery due/claim/lease index
because the linked outbox row exclusively owns that job state. Outbox payload
contains only row/token/invite IDs and template version. Store no rendered
link, raw email, or raw token. Retain seven years after the latest of delivery,
bounce, complaint, permanent failure, cancellation, or creation; then set both
envelopes and their key versions/nonces to null while retaining suppression
HMAC/version, masked address, state, and
evidence required by audit/legal hold.

Encrypt recipient and failure PII with separate AES-256-GCM envelope operations.
AAD is the UTF-8 encoding of
`boe-email-delivery-v1|<field>|<delivery-id>|<template-key>|<template-version>`,
where `<field>` is exactly `recipient` or `failure_detail`; encryption and
decryption must reconstruct these normalized values byte-for-byte. Nonces are
random 96-bit values and may never repeat for a key. New writes use the current
managed encryption-key version; reads select the recorded version. A legal hold
blocks purge. Setting ciphertext, nonce, and recorded key version to null in
the audited retention transaction is the primary-database encrypted-field purge
boundary, not cryptographic erasure: this design has no per-record
data-encryption key to destroy. Encrypted backups and WAL remain
access-controlled and recoverable for at most 35 days, after which lifecycle
deletion removes them. Any restore first runs retention reconciliation before
application access, re-purging fields whose deadlines passed. Keys referenced
by an in-policy backup remain available only to the restricted recovery role
until that backup expires.

The first outbox attempt is immediate. Retry delays after failed attempts are exactly one
minute, five minutes, 15 minutes, one hour, four hours, 12 hours, and 24 hours,
with deterministic jitter bounded to plus/minus 20 percent. Attempt eight is
terminal. In the short pre-send transaction the worker re-locks the outbox,
delivery, and referenced token/invite, checks suppression, and atomically
cancels obsolete work with `VERIFICATION_TOKEN_REVOKED` or
`ACTIVATION_INVITE_REVOKED`, or transitions both owning outbox state and delivery
evidence to the `sending` point of no return. SES network calls occur only after
that transaction commits. Delivery state, attempts, timestamps, and failure projection are
updated in the same result transaction as the outbox state; they never drive a
claim or retry independently.

#### `email_provider_events`

| Column | Definition |
| --- | --- |
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `sns_message_id` | `text NOT NULL UNIQUE` |
| `sns_topic_arn` | `text NOT NULL` |
| `sns_type` | `text NOT NULL` |
| `ses_event_type` | `text NULL` |
| `ses_message_id` | `text NULL` |
| `delivery_correlation_id` | `uuid NULL` |
| `email_delivery_id` | `uuid NULL REFERENCES email_deliveries(id) ON DELETE RESTRICT` |
| `payload_ciphertext` | `bytea NULL` |
| `payload_nonce` | `bytea NULL` |
| `payload_sha256` | `bytea NOT NULL` |
| `payload_key_version` | `text NULL` |
| `state` | `text NOT NULL DEFAULT 'received'` |
| `received_at` | `timestamptz NOT NULL DEFAULT now()` |
| `processed_at` | `timestamptz NULL` |
| `expires_at` | `timestamptz NOT NULL` |
| `erased_at` | `timestamptz NULL` |

Checks limit SNS type to `Notification`, `SubscriptionConfirmation`, or
`UnsubscribeConfirmation`; internal event type to Delivery/Bounce/Complaint/
Reject/RenderingFailure/DeliveryDelay when present; state to
`received|processed|ignored|unmatched`; digest to 32 bytes; and terminal
timestamps to terminal states. A validated SES message tag
`boe_delivery_id=<uuid>` is stored as `delivery_correlation_id` and may resolve
the delivery before the SES result transaction records `ses_message_id`.
It is signed correlation evidence, not a foreign key: a valid but unknown UUID
must still commit and become `unmatched`. Only resolved `email_delivery_id` has
the delivery FK.
The strict raw SES parser accepts rendering
failure only as `eventType: "Rendering Failure"` with object key `failure`, then
normalizes it to internal `RenderingFailure`. The ciphertext envelope is
AES-256-GCM with a random 12-byte nonce and 16-byte tag. Ciphertext, nonce, and
key version are all present before erasure and all null after `erased_at`; the
digest and redacted processing outcome remain. AAD is the UTF-8 encoding of
`boe-email-provider-event-v1|payload|<event-id>|<sns-message-id>|<sns-topic-arn>`
using the same normalized, versioned convention as email-delivery PII. Index `(state, received_at, id) WHERE state =
'received'`, `(state, delivery_correlation_id, received_at, id) WHERE state =
'unmatched'`, `(ses_message_id)`, and `(expires_at, id)`. Signature/topic/cert/
timestamp validation occurs before insertion. Duplicate SNS message ID returns
success without a second transition. Matched records inherit the delivery's
seven-year retention. Unmatched valid events expire seven days after
`received_at`; subscription records expire one year after receipt.

#### `email_suppressions`

| Column | Definition |
| --- | --- |
| `recipient_hmac` | `bytea NOT NULL` |
| `suppression_hmac_key_version` | `text NOT NULL` |
| `reason` | `text NOT NULL` |
| `source_event_id` | `uuid NOT NULL REFERENCES email_provider_events(id) ON DELETE RESTRICT` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `lifted_at` | `timestamptz NULL` |
| `lifted_by_user_id` | `uuid NULL REFERENCES users(id) ON DELETE RESTRICT` |
| `lift_reason` | `text NULL` |

Primary key `(recipient_hmac, suppression_hmac_key_version)`. HMAC is 32 bytes and is generated
only with a dedicated versioned suppression-HMAC key, never an IP, rate-limit,
token, cursor, or encryption key; reason is `bounce` or `complaint`; lift fields are all null or
all present with a 10-1,000 character reason. Active suppressions are checked
before every send and never expire automatically. A complaint may be lifted
only through a separately authorized, audited process after renewed consent;
permanent-bounce suppressions are not lifted. No raw address is stored.

Before every send, normalize the recipient and compute candidate HMACs for all
active suppression-key versions, then look up all `(recipient_hmac,
suppression_hmac_key_version)` candidates. Rotation dual-writes the old and new versions and
backfills active rows before the old version is retired; lookup continues
across both versions until migration completeness is verified. The old key may
be retired only after every active suppression has a new-version row and all
in-flight deliveries record the new `suppression_hmac_key_version`.

## 4. Canonical later-domain schema

These definitions are canonical. They may be introduced by later additive
migrations, but must not be replaced by JSON collection tables.

Section 4 uses compact DDL notation. `UUID PK` expands to `id uuid PRIMARY KEY
DEFAULT gen_random_uuid()`. `timestamps` expands to `created_at timestamptz NOT
NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()`. A mutable
row's `version` is `bigint NOT NULL DEFAULT 1 CHECK (version > 0)`. Bare
`user_id`, `fund_id`, `order_id`, `payment_id`, `mandate_id`, `sip_plan_id`, and
`kyc_case_id` columns are `uuid NOT NULL`; their named parent FK is `ON DELETE
RESTRICT` unless a different action is stated. Bare transition timestamps are
`timestamptz NULL`; bare dates are `date`; required labels are `text NOT NULL`
with a nonblank check. Queue indexes named below are partial indexes over the
listed nonterminal states.

### 4.1 Compliance

- `investor_profiles`: `user_id uuid PRIMARY KEY REFERENCES users ON DELETE
  RESTRICT`, `date_of_birth_ciphertext bytea NULL`, `date_of_birth_nonce bytea
  NULL`, `address_ciphertext bytea NULL`, `address_nonce bytea NULL`,
  `encryption_key_version text NULL`, `erased_at timestamptz NULL`,
  `tax_residency_country char(2) NULL`, timestamps, version. Country is uppercase
  ISO-3166 alpha-2. Before erasure each present ciphertext has its random
  12-byte AES-256-GCM nonce and the shared nonblank key version; after erasure
  ciphertext/nonces/key version are null and `erased_at` is set. AAD is exact
  UTF-8 `boe-investor-profile-v1|<field>|<user-id>` where field is
  `date_of_birth` or `address`. Encrypted values are never copied to audits.
- `kyc_cases`: `id uuid PK`, `user_id uuid NOT NULL`, `state kyc_case_state`,
  `provider text NULL`, `provider_case_id text NULL`, `submitted_at`,
  `review_started_at`, `decided_at`, `expires_at`, `created_at`, `updated_at`,
  `version`; unique `(id,user_id)`, unique provider pair when non-null, and one
  nonterminal case per user via partial unique `(user_id) WHERE state IN
  ('pending_submission','submitted','in_review','needs_information')`. Composite
  FK ownership is used by child rows; index `(state, submitted_at, id)` over
  `submitted` and `in_review`.
- `kyc_documents`: `id uuid PK`, `kyc_case_id uuid NOT NULL`, `user_id uuid NOT
  NULL`, `document_type text NOT NULL`, `object_key text NOT NULL`,
  `content_sha256 bytea NOT NULL`, `encryption_key_version text NOT NULL`,
  `created_at`; composite FK `(kyc_case_id,user_id)`, unique
  `(kyc_case_id,document_type,content_sha256)`. Object keys are opaque; no public
  URLs or file bodies.
- `kyc_reviews`: `id uuid PK`, `kyc_case_id`, `user_id`, `reviewer_user_id`,
  `from_state`, `to_state`, `reason_code`, `reason_detail`, `request_id`,
  `created_at`; composite ownership FK, append-only, index case chronology.
- `risk_assessments`: `id uuid PK`, `user_id uuid NOT NULL`, `state
  risk_assessment_state`, `questionnaire_version text NOT NULL`, `answers jsonb
  NOT NULL DEFAULT '{}'`, `score integer NULL`, `category risk_category NULL`,
  `submitted_at`, `assessed_at`, `created_at`, `updated_at`, `version`; unique
  `(id,user_id)`, one non-assessed row per user, score 0-100, score/category and
  assessed timestamp required only in assessed state. Enforce one open row with
  partial unique `(user_id) WHERE state IN ('not_started','submitted')`. Index
  `(state, submitted_at, id) WHERE state = 'submitted'`. Retain compliance records
  for a minimum of eight years after relationship closure; never cascade from
  user. A legal hold suspends expiry.

### 4.2 Catalog

- `funds`: UUID PK; unique normalized `slug`; `state fund_state`;
  `current_published_version_id uuid NULL`; `published_at`, `paused_at`,
  `archived_at`, `created_by_user_id`, timestamps, version. Add the pointer FK
  after `fund_versions` exists. The pointer is null before first publication
  and references a version of the same fund through composite FK
  `(current_published_version_id, id) -> fund_versions(id, fund_id)`.
  State timestamps are coherent.
- `fund_versions`: UUID PK; `fund_id`; positive `version`; `name`, `category`,
  `objective`, `risk_level fund_risk_level`; `currency char(3) DEFAULT 'INR'`;
  `minimum_sip_paise bigint`, `minimum_purchase_paise bigint`;
  `minimum_duration_months integer NULL`, `recommended_holding_months integer
  NULL`; `disclosure_version_id uuid NOT NULL`; `initial_nav_price_id uuid NOT
  NULL`; `terms_sha256 bytea NOT NULL`; `created_by_user_id`; `created_at`.
  Unique `(fund_id, version)` and `(id, fund_id)`; amounts are nonnegative,
  durations positive, and digest is 32 bytes. Composite FKs
  `(disclosure_version_id,fund_id) -> fund_disclosure_versions(id,fund_id)` and
  `(initial_nav_price_id,fund_id) -> fund_nav_prices(id,fund_id)` enforce that
  linked disclosure/NAV belong to the same fund. Versions are immutable. Every first investable publication
  and every later version changing canonical commercial, risk, or disclosure
  terms requires maker-checker and atomically moves
  `current_published_version_id` only after the approved version, disclosure,
  and initial/current NAV exist.
- `fund_disclosure_versions`: UUID PK; `fund_id` restricted FK; positive
  `version`; `title`, `body`, `content_sha256 bytea`; `effective_from`;
  `published_by_user_id`; timestamps; unique `(fund_id,version)`, unique
  `(id,fund_id)`, and append-only.
- `fund_nav_prices`: UUID PK; `fund_id`; `nav numeric(24,8) > 0`; `as_of_date`;
  `revision integer NOT NULL DEFAULT 1 CHECK (revision > 0)`; `source`;
  `published_by_user_id`; timestamps; unique
  `(fund_id,as_of_date,revision)` and unique `(id,fund_id)`. Corrections insert a superseding revision and
  retain all revisions; current read chooses greatest revision.
- `fund_positions`: UUID PK; `fund_id`; `as_of_date`; `revision integer NOT NULL
  DEFAULT 1 CHECK (revision > 0)`; `asset_key`, `asset_name`, `asset_class`,
  `sector`; `allocation_percent numeric(24,8)` between 0 and 100; `source`;
  timestamps; unique `(fund_id,as_of_date,revision,asset_key)`. A correction is
  a complete higher revision for the date; reads never combine revisions.
- `fund_aum_snapshots`: UUID PK; `fund_id`; `as_of_date`; `aum_paise bigint >=
  0`; `source`; `revision integer > 0`; `published_by_user_id`; timestamps;
  unique `(fund_id,as_of_date,revision)`. A correction is a new maker-checker
  approved revision. This is published presentation data, not a ledger.

Catalog history is never cascaded from funds. Archived funds remain resolvable
from financial history. Published fund versions, disclosures, NAVs, positions, and AUM
snapshots are append-only and retained indefinitely.

### 4.3 Investing and ownership

- `sip_plans`: UUID PK; `user_id`, `fund_id`; `amount_paise bigint > 0`;
  `debit_day integer` 1-28; optional positive `duration_months`; `state
  sip_state`; `mandate_id uuid NULL`; `start_date`, `next_due_date`,
  `paused_at`, `cancelled_at`, `completed_at`; timestamps, version. Unique
  `(id,user_id)`. Composite `(mandate_id,user_id) -> mandates(id,user_id)` when
  a mandate is linked. Fund/user deletes restricted. One active schedule per
  user and fund is not assumed, and multiple live SIPs may share one mandate.
- `investment_orders`: UUID PK; `user_id`, `fund_id`, optional `sip_plan_id`;
  `type order_type`; `state order_state`; `amount_paise bigint NULL`;
  `requested_units numeric(24,8) NULL`; `currency char(3) DEFAULT 'INR'`;
  timestamps for requested/payment-confirmed/booked/cancelled; `failure_code`;
  timestamps, version. Unique `(id,user_id)`. Composite `(sip_plan_id,user_id)`
  FK. Purchase/SIP orders require positive amount; redemption requires positive
  units; non-redemption types prohibit requested units.
- `investment_executions`: UUID PK; `order_id`, `user_id`, `fund_id`; `type
  execution_type`; `amount_paise bigint > 0`; `nav numeric(24,8) NULL`; `units
  numeric(24,8) NULL`; `executed_at`; `reverses_execution_id uuid NULL`;
  `provider_reference`; `created_at`. Composite `(order_id,user_id)` FK, unique
  `(id,user_id,fund_id)` and `(id,order_id,user_id,fund_id)`, unique provider
  reference where present, and at most one non-reversal booking per
  order. `refund` requires both NAV and units null plus a nonblank provider
  reference and positive money evidence; `allotment`, `redemption`,
  `reversal`, and `adjustment` require both positive. Only `reversal` has a
  non-null `reverses_execution_id`; add a self-FK plus unique partial index on
  that ID, using `(reverses_execution_id,order_id,user_id,fund_id)` to require
  the original to be a non-reversal execution for the same order/user/fund.
  Append-only.
- `holdings`: UUID PK; `user_id`, `fund_id`; `total_units numeric(24,8) >= 0`;
  `reserved_units numeric(24,8) >= 0`; `cost_basis_paise bigint >= 0`;
  timestamps, version; unique `(user_id,fund_id)`, `(id,user_id)`, and
  `(id,user_id,fund_id)`, and
  reserved units cannot exceed total units.
- `holding_lots`: UUID PK; `holding_id`, `user_id`, `fund_id`,
  `source_execution_id`; `acquired_on date`; `cost_basis_paise bigint >= 0`;
  `original_units`, `remaining_units`, `reserved_units` as positive/nonnegative
  `numeric(24,8)`; timestamps, version. Composite `(holding_id,user_id)` FK;
  composite `(source_execution_id,user_id,fund_id)` FK; unique
  `(id,holding_id,user_id,fund_id)` and source execution; remaining cannot exceed original, reserved cannot
  exceed remaining.
- `holding_lot_movements`: UUID PK; `holding_lot_id`, `holding_id`, `user_id`,
  `fund_id`, `execution_id`; `movement_type text`; `units_delta numeric(24,8)
  NOT NULL`; `cost_basis_delta_paise bigint NOT NULL`; `occurred_at`,
  `created_at`. Composite FKs `(holding_lot_id,holding_id,user_id,fund_id)`,
  `(holding_id,user_id,fund_id)`, and `(execution_id,user_id,fund_id)` require
  the lot, holding, and execution to share one owner/fund. Movement type is
  `allotment|redemption|reversal|adjustment`;
  units delta is nonzero: allotment is positive, redemption is negative,
  reversal is the exact negation of the original linked movement, and an
  adjustment follows its approved signed correction payload. Unique
  `(execution_id, holding_lot_id, movement_type)`. Rows are append-only and are
  the authoritative projection source for each lot/holding delta; current lot
  and holding balances must equal the ordered fold of their movements.
- `redemption_requests`: UUID PK; `order_id`, `user_id`, `fund_id`; `state
  redemption_state`; `requested_units numeric(24,8) > 0`; `reserved_units
  numeric(24,8) >= 0`; `estimated_value_paise bigint > 0`;
  `finance_policy_version integer NOT NULL REFERENCES finance_policy_versions(version)
  ON DELETE RESTRICT`; `requires_dual_approval boolean`; timestamps for
  submitted/reserved/approved/settled/cancelled; `reason_code`; timestamps,
  version. Composite `(order_id,user_id)` FK, unique order ID, reserved units
  cannot exceed requested units, and `requires_dual_approval` equals the result
  of comparing estimated value with the referenced typed paise threshold at
  submission.

All ownership and financial FKs use `ON DELETE RESTRICT`. Index every client
history as `(user_id, created_at DESC, id DESC)` and every operations queue as
`(state, updated_at, id)`. Holdings and lots are authoritative ownership;
portfolio snapshots, if later added, are read-only caches. Retain orders,
executions, holdings, lots, lot movements, SIPs, and redemptions for a minimum of ten years
after the user relationship closes; a legal hold suspends expiry.

Financial arithmetic is exact and centralized. Persist NAV and units at scale
8. For an amount-based allotment, compute units as
`amount_paise / 100 / nav` and round once to eight decimals using round-half-to-
even. For a unit-based execution, compute paise as `units * nav * 100` and
round once to an integer using round-half-to-even. Never chain binary floating
point or intermediate display rounding. On partial lot depletion, allocate
cost basis as round-half-to-even of
`old_cost_basis_paise * redeemed_units / old_remaining_units`; when a lot is
fully depleted, consume its entire remaining cost-basis residual. Process lots
by acquisition date then ID, and assign any aggregate paise residual to the
last consumed lot so movement deltas sum exactly to the execution amount/cost
basis. After every transaction, holding units/cost basis equal the exact sum of
lot balances and no negative residual is permitted.

### 4.4 Payments and provider inbox

- `payments`: UUID PK; `order_id`, `user_id`; `amount_paise bigint > 0`;
  `currency char(3) DEFAULT 'INR'`; `state payment_state`; `succeeded_at`,
  `failed_at`, `refunded_at`; timestamps, version. Composite
  `(order_id,user_id)` FK; unique order ID; unique `(id,user_id)` before any
  referencing composite FK; state timestamps coherent.
- `payment_attempts`: UUID PK; `payment_id`, `user_id`; `attempt_number integer
  > 0`; `provider`, optional `provider_payment_id`; `state payment_state` limited
  to `created`, `provider_pending`, `succeeded`, `failed`, `expired`;
  `failure_code`; `expires_at`; timestamps, version. Composite
  `(payment_id,user_id)` FK; unique `(payment_id,attempt_number)` and provider
  pair where present.
- `mandates`: UUID PK; `user_id`; `provider`, optional `provider_mandate_id`;
  `max_amount_paise bigint > 0`; `frequency` checked to supported values;
  optional `debit_day` 1-28; `state mandate_state`; `valid_from`, `valid_to`,
  timestamps, version. Unique `(id,user_id)` is the SIP ownership anchor;
  provider pair is unique and `(user_id,state,created_at DESC)` is indexed.
  Mandates do not own a single SIP FK because one mandate may authorize several
  SIPs for the same user.
- `provider_events`: UUID PK; `provider`, `provider_event_id`; `event_type`;
  `state provider_event_state`; `signature_valid boolean`; `payload_ciphertext
  bytea NULL`; `payload_nonce bytea NULL`; `payload_key_version text NULL`;
  `payload_sha256 bytea`; `erased_at timestamptz NULL`; optional `payment_id`, `mandate_id`, `user_id`;
  `attempt_count integer NOT NULL DEFAULT 0`; `available_at timestamptz NOT NULL
  DEFAULT now()`; `locked_at timestamptz NULL`; `locked_by text NULL`;
  `processed_at`; `last_error_code`; timestamps, version. Unique
  `(provider,provider_event_id)`; composite subject FKs where subject exists;
  partial claim index `(available_at,created_at,id) WHERE state = 'received'`.
  Checks require a valid signature, 32-byte payload digest, nonnegative attempts,
  an all-present AES-256-GCM ciphertext/12-byte nonce/key-version envelope before
  erasure and an all-null envelope after `erased_at`, and coherent
  lease/terminal timestamps. AAD is exact UTF-8
  `boe-financial-provider-event-v1|payload|<event-id>|<provider>|<provider-event-id>`.
  Reject invalid
  signatures before inserting business changes; retain
  encrypted raw evidence for provider/legal retention, then purge its envelope from the primary database and
  keep the digest plus processing outcome.

Retain payments, attempts, mandates, and provider-event digests for a minimum
of ten years after terminal state. Retain encrypted raw financial-provider
payloads for seven years after processing, then purge each encrypted payload
field from the primary database while keeping its digest and redacted outcome. A legal hold suspends
either expiry.

`notifications` contains UUID PK, restricted `user_id`, kind/title/body,
`read_at`, allowlisted JSON object payload, and timestamps; index
`(user_id, read_at, created_at DESC)`. Notifications contain no provider payload,
token, KYC identifier, or sensitive audit detail and may be deleted 24 months
after creation.

### 4.5 Platform, policy, and content

- `finance_policy_versions`: UUID PK; `version integer NOT NULL CHECK (version >
  0)`; `redemption_dual_approval_threshold_paise bigint NOT NULL DEFAULT
  10000000 CHECK (redemption_dual_approval_threshold_paise > 0)`;
  `effective_from timestamptz NOT NULL`; `retired_at timestamptz NULL`;
  `published_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT`;
  `created_at timestamptz NOT NULL DEFAULT now()`. Unique version and one active
  row via partial unique constant index `((true)) WHERE retired_at IS NULL`.
  Retirement follows effective time. The explicit default is INR 100,000.00;
  deployments change it only by publishing a new typed version. Every order or
  approval stores the policy version it evaluated. No monetary approval
  threshold may come from JSON/app config or a hard-coded service constant.
- `marketing_leads`: UUID PK; nullable AES-256-GCM envelopes
  `full_name_ciphertext/full_name_nonce`, `email_ciphertext/email_nonce`, and
  `phone_ciphertext/phone_nonce`; nullable `email_hmac bytea` and `phone_hmac
  bytea`; nullable `pii_key_version text`; `pii_erased_at timestamptz NULL`;
  `source text NOT NULL`; `state text NOT NULL DEFAULT 'new'`; `application_id uuid NULL
  REFERENCES applications(id) ON DELETE RESTRICT`; timestamps, version. Full
  name uses the canonical 2-120 Unicode-code-point rule before encryption.
  Nonces are 12 bytes and HMACs are 32 bytes; before erasure the full-name and
  email envelopes, email HMAC, and key version are present, while phone
  ciphertext/nonce/HMAC are either all null or all present. After erasure all
  ciphertext, nonce, HMAC, and key-version fields are null, `pii_erased_at` is
  set, and state is `closed`. AES-GCM AAD is exact UTF-8
  `boe-marketing-lead-v1|<field>|<lead-id>|<source>`. State is
  `new|contacted|converted|closed`. Partial unique `(email_hmac) WHERE state IN
  ('new','contacted')`, index `(state, created_at DESC, id DESC)`, and unique
  application ID when linked. Retain unconverted lead PII until 24 months after
  `created_at`; converted leads follow the linked application's retention.
  Cleanup purges every PII envelope and lookup HMAC from the primary database, records
  `pii_erased_at`, and closes the row.
- `courses`: UUID PK; normalized `slug`; `version integer > 0`; `title
  text`, `summary text`, `price_paise bigint >= 0`, `currency char(3) DEFAULT
  'INR'`, `duration_minutes integer > 0`, `state text DEFAULT 'draft'`,
  `published_by_user_id uuid NULL REFERENCES users(id) ON DELETE RESTRICT`,
  `published_at`, `archived_at`, timestamps. State is
  `draft|published|archived`; unique `(slug, version)` replaces a scalar slug
  uniqueness when multiple versions exist, and one published version per slug
  is enforced by a partial unique index. Published rows are immutable.
- `membership_plans`: UUID PK; normalized `code`; positive `version`;
  `name text`, `description text`, `price_paise bigint >= 0`, `currency char(3)
  DEFAULT 'INR'`, `billing_period_months integer > 0`, `state text DEFAULT
  'draft'`, `published_by_user_id`, `published_at`, `archived_at`, timestamps.
  State is `draft|published|archived`; unique `(code, version)` replaces scalar
  code uniqueness when multiple versions exist, one published version per code
  is enforced, and published rows are immutable.
- `app_config_versions`: UUID PK; positive `version`; `payload jsonb NOT NULL`;
  `content_sha256 bytea NOT NULL`; `published_by_user_id uuid NOT NULL
  REFERENCES users(id) ON DELETE RESTRICT`; `published_at timestamptz NOT
  NULL`; `retired_at timestamptz NULL`; `created_at`. Unique version, 32-byte
  digest of RFC 8785 canonical payload, object payload, and one current row via
  partial unique constant index. Payload contains only typed presentation,
  feature-flag, minimum-client-version, and download metadata; products, funds,
  money, ownership, permissions, approval thresholds, and lifecycle state are
  forbidden. Published rows are immutable except retirement.
- `content_items`: UUID PK; `content_key text NOT NULL`; `kind text NOT NULL`;
  `version integer NOT NULL`; `title text NOT NULL`; `body text NOT NULL`;
  `payload jsonb NOT NULL DEFAULT '{}'::jsonb`; `state text NOT NULL DEFAULT
  'draft'`; `published_by_user_id uuid NULL REFERENCES users(id) ON DELETE
  RESTRICT`; `published_at timestamptz NULL`; `archived_at timestamptz NULL`;
  timestamps. Unique `(content_key,version)` and one published version via
  partial unique `(content_key) WHERE state = 'published'`; index
  `(kind,state,content_key)`. Kind includes `faq`, `static_page`, and
  `legal_disclosure`; state is `draft|published|archived`; version is positive;
  payload is an object; state timestamps are coherent. FAQs are only
  `content_items(kind='faq')`; there is no canonical `faqs` table. Published
  versions are append-only and retained indefinitely.

## 5. Lifecycle command contract

### 5.1 Universal transition rules

Every command takes `{ actor, requestId, expectedVersion?, idempotencyKey?,
reasonCode?, reasonDetail? }`; only the route contract decides which optional
fields are required. It must:

1. For commands requiring idempotency, acquire the canonical-scope advisory
   transaction lock and inspect a completed `idempotency_records` row.
2. Lock the aggregate with `SELECT ... FOR UPDATE`, or use a single guarded
   `UPDATE ... WHERE id = ? AND state IN (...) AND version = ? RETURNING *`.
3. Validate actor permission, ownership, current state, timestamps, prerequisites,
   and command payload.
4. Update by creating a new domain value, increment `version`, and set
   `updated_at` and the transition timestamp from database `now()`.
5. Append an `audit_events` row with old/new state and resulting version.
6. Enqueue required outbox work and, when applicable, insert the completed
   idempotency response in the same transaction.

Repositories return domain failures; the HTTP adapter is the only layer that
assigns stable wire errors. The mapping is exact:

| Domain result | HTTP / wire code |
| --- | --- |
| Schema/boundary failure | `400 VALIDATION_FAILED` |
| Malformed, expired, cross-route, or filter-mismatched cursor | `400 CURSOR_INVALID` |
| Invalid or unknown token | `400 TOKEN_INVALID` |
| Missing principal | `401 AUTHENTICATION_REQUIRED` |
| Bad login identifier/password | `401 INVALID_CREDENTIALS` |
| Invalid, expired, revoked, or reused session | `401 SESSION_INVALID` |
| Invalid SNS provenance | `401 SNS_SIGNATURE_INVALID` |
| Missing permission | `403 AUTHORIZATION_DENIED` |
| Non-active client account | `403 ACCOUNT_NOT_ACTIVE` |
| CSRF/origin/fetch-metadata failure | `403 CSRF_INVALID` |
| Missing or wrong-owner resource | `404 RESOURCE_NOT_FOUND` |
| Existing active application/account on authenticated admin/internal routes only | `409 ACTIVE_APPLICATION_EXISTS` |
| Wrong state, expected version/invite, lock timeout, or stale prerequisite | `409 STATE_CONFLICT` |
| Same idempotency scope/key with another hash | `409 IDEMPOTENCY_KEY_REUSED` |
| Advisory idempotency lock unavailable | `409 IDEMPOTENCY_IN_PROGRESS` |
| Consumed or revoked token | `409 TOKEN_ALREADY_USED` |
| Expired valid token | `410 TOKEN_EXPIRED` |
| Body limit exceeded | `413 PAYLOAD_TOO_LARGE` |
| Wrong media type | `415 UNSUPPORTED_MEDIA_TYPE` |
| Rate policy exceeded | `429 RATE_LIMITED` |
| Unexpected failure | `500 INTERNAL_ERROR` |
| Database/secret/provider unavailable | `503 DEPENDENCY_UNAVAILABLE` |

No older internal names such as `VALIDATION_ERROR`, `FORBIDDEN`,
`INVALID_STATE_TRANSITION`, `VERSION_CONFLICT`, `RESOURCE_BUSY`,
`PRECONDITION_FAILED`, `TOKEN_INVALID_OR_EXPIRED`, or `SESSION_REVOKED` appear
on the wire. A same-key/same-hash completed retry returns the original response
without another transition or side effect.

`POST /v1/applications` is the enumeration-safe exception to the conflict row:
a new submission and every duplicate active application/account return the
same generic `202 { accepted: true }` envelope with no UUID, state, duplicate
flag, expiry, or identifier-specific detail. The application service may use an
internal duplicate disposition to decide whether a cooldown-safe replacement
verification delivery is required, but `ACTIVE_APPLICATION_EXISTS` is emitted
only to authenticated admin/internal callers and never by the public route.

### 5.2 Exact transition matrix

| Aggregate | Command and actor | From -> to | Guard and effects |
| --- | --- | --- | --- |
| Application | `submitApplication`, public | none -> `pending_email_verification` | Normalized unique email/phone, current consent versions, valid input. Create application, consents, token, email delivery, outbox, audit, and completed idempotency response atomically. A unique conflict follows duplicate policy and returns the identical generic 202; return no UUID or duplicate disposition. |
| Application | `verifyApplicationEmail`, public | `pending_email_verification` -> `submitted` | Lock token and application; token pending, unexpired, hash matches. Consume token; set verified/submitted timestamps. Map consumed/revoked to `409 TOKEN_ALREADY_USED`, expiry to `410 TOKEN_EXPIRED`, and malformed/unknown to `400 TOKEN_INVALID`; return no application UUID. |
| Application | `startApplicationReview`, onboarding admin | `submitted` -> `in_review` | Permission `applications.review`; set review-started timestamp. Multiple reviewers cannot acquire the same transition. |
| Application | `approveApplication`, onboarding admin | `in_review` -> `approved` | Permission; verified email; no prior review/user; reason supplied. Create review, user in invited state, invite, email delivery/outbox, and audit in one transaction. |
| Application | `rejectApplication`, onboarding admin | `in_review` -> `rejected` | Permission, reason supplied, no user exists. Create review, required `application_rejected` email delivery/outbox, and audit atomically; email failure never creates a user or rolls back the decision. |
| Application | `withdrawApplication`, authenticated onboarding admin/internal support | `pending_email_verification` or `submitted` -> `withdrawn` | First release has no public withdrawal endpoint. Require authorization, applicant request evidence, and reason; revoke outstanding verification tokens. In-review or terminal applications conflict. |
| User | `activateUser`, public invite bearer | `invited` -> `active` | Lock invite/user; pending unexpired invite; no credential. Create Argon2id credential, accept invite, activate user, create initial session/token, audit atomically. |
| User | `suspendUser`, authorized admin | `active` -> `suspended` | `users.suspend`, nonblank reason. Revoke every active session and current refresh token in the same transaction. |
| User | `reinstateUser`, authorized admin | `suspended` -> `active` | `users.reinstate`, reason and remediated suspension checks. Does not recreate sessions. |
| User | `closeUser`, authorized admin | `invited`, `active`, or `suspended` -> `closed` | `users.close`, reason, retention checks; revoke sessions and pending invites and set `user_credentials.password_hash = NULL` in the same transaction. Closed is terminal. |
| Invite | `resendActivationInvite`, onboarding admin | current `pending` -> `revoked`; new row -> `pending` | User remains invited and has no credentials. Lock user and pending invite, revoke old invite, create new token/email/outbox. Expired pending invite is still revoked explicitly. |
| Invite | `acceptActivationInvite`, public bearer | `pending` -> `accepted` | Same atomic activation command; unexpired, unused hash. Acceptance cannot be performed independently. |
| Invite | `revokeActivationInvite`, onboarding admin/system | `pending` -> `revoked` | Reason required. Accepted/revoked conflicts; expiry alone is derived and does not mutate state. |
| Email | `beginEmailAttempt`, worker | `queued` or `retryable_failed` -> `sending` | In one short transaction lock the claimed outbox, delivery, and referenced token/invite; validate lease, current token/invite, and suppression; increment evidence once and transition outbox `processing -> sending` plus delivery to `sending`. Commit before SES. This is the point of no return. |
| Email | `recordEmailSent`, worker | `sending` -> `sent` | SES message ID required and unique; set sent timestamp and linked outbox `delivered`/`delivered_at`, clearing lease fields, in the same transaction. |
| Email | `recordEmailDelivered`, signed SNS provider | `sent` -> `delivered` | Valid SNS signature and matching SES message ID; duplicate SNS event is idempotent. |
| Email | `recordEmailRetryableFailure`, worker | `sending` -> `retryable_failed` | Allowlisted pre-acceptance transient code; atomically return outbox to retryable failure with its next `available_at` and clear lease fields. A stale outbox lease is recovered through this command. |
| Email | `recordEmailDeliveryDelay`, signed SNS provider | `sent` -> `sent` | Append monotonic delay evidence/alert only. SES already accepted the message, so outbox remains delivered and no duplicate resend is scheduled. |
| Email | `recordEmailPermanentFailure`, worker | `sending` or `retryable_failed` -> `permanent_failed` | Permanent pre-acceptance send/configuration error or attempts exhausted; atomically dead-letter the linked outbox and clear its lease; no automatic retry. |
| Email | `recordEmailProviderReject`, signed SNS provider | `sent` -> `permanent_failed` | Record signed reject/rendering-failure evidence. Outbox remains delivered because transport acceptance already occurred; no resend. |
| Email | `cancelObsoleteEmail`, worker/system | `queued` or `retryable_failed` -> `cancelled` | Before the committed `sending` point of no return, atomically cancel linked outbox/delivery with `VERIFICATION_TOKEN_REVOKED` or `ACTIVATION_INVITE_REVOKED`. After `sending`, do not cancel or retry; an email may arrive but the token/invite is invalid. Cancelled is terminal. |
| Email | `recordEmailBounceOrComplaint`, signed SNS provider | any sent/delivered state retains its monotonic state; unsent state -> `permanent_failed` | Set bounced/complained evidence, upsert suppression, and alert. A late safety event never erases `delivered_at` or regresses delivered state. |
| Session | `createSession`, authentication service | none -> `active` | Active user and valid credential; create session plus generation-zero refresh token. Native device uniqueness is enforced. |
| Session | `rotateRefreshToken`, user token | `active` -> `active` | Lock session and current token. Persist the client-provided `rotationId`; never generate it server-side. Move current refresh hash/key version to the previous session fields, and for web move current CSRF hash/key version to its previous fields with the same 30-second validity. Increment generation and atomically store the derived successor refresh row and successor CSRF pair. |
| Session | `retryRefreshRotation`, user token | `active` -> `active` without a write | Within 30 seconds, native retry requires previous refresh plus the same persisted `rotationId`; web retry requires previous refresh and previous CSRF plus that same ID. Reproduce the byte-identical committed successor pair using the recorded key versions. Do not increment generation or append a second transition. |
| Session | `recoverPartialWebRefresh`, web user | `active` -> `active` without a write | If the browser accepted the successor refresh cookie but lost the response body, accept current refresh + previous CSRF only with the same persisted `rotationId` inside the 30-second grace and reproduce the current CSRF/access result. Any other mixed pair fails without creating a new rotation. |
| Session | `detectRefreshReuse`, user token/system | `active` -> `revoked` | Presented hash identifies an older family token, or the previous hash after its retry window. Revoke session and all current tokens with `refresh_reuse`; map to `401 SESSION_INVALID`. |
| Session | `logoutSession`, user/admin | `active` -> `revoked` | Own session or permission; revoke current refresh token. Same-key retry succeeds; another logout conflicts only internally and API may map already revoked own session to successful logout. |
| Session | `expireSession`, system/read path | `active` -> `expired` | Database time is at/after expiry. Revoke current tokens; no client-supplied time. Revoked/expired are terminal. |
| RBAC | `changeRolePermissions`, authorized checker | captured grants -> approved delta | Execute approved `rbac.permissions.change`; lock target user/role plus affected grants in ID order, revalidate maker/checker and target version, then append/revoke the exact payload-bound grants with audit in one transaction. No superadmin or bootstrap runtime bypass. |
| KYC | `startKyc`, active user | none -> `pending_submission` | One nonterminal case; eligibility remains pending. |
| KYC | `submitKyc`, owner | `pending_submission` or `needs_information` -> `submitted` | Required encrypted profile fields/documents and current consent exist. |
| KYC | `startKycReview`, compliance admin | `submitted` -> `in_review` | `kyc.review`; lock case and append review evidence. |
| KYC | `approveKyc`, compliance admin | `in_review` -> `approved` | Validation/provider checks passed; expiry required; append review. |
| KYC | `rejectKyc`, compliance admin | `in_review` -> `rejected` | Reason required; append review. Rejected is terminal for this case; a new case is required. |
| KYC | `requestKycInformation`, compliance admin | `in_review` -> `needs_information` | Reason and requested field/document list required. |
| Risk | `startRiskAssessment`, active user | none -> `not_started` | Current questionnaire version. |
| Risk | `submitRiskAssessment`, owner | `not_started` -> `submitted` | Complete validated answers; set submitted timestamp. |
| Risk | `assessRisk`, system/compliance admin | `submitted` -> `assessed` | Deterministic versioned scoring produces score/category. Assessed is terminal; reassessment creates a new row. |
| Fund | `requestFundReview`, content/finance maker | `draft` -> `review_pending` | Create the first immutable complete `fund_versions` row with linked disclosure and NAV plus `fund.publish_investable_version`; there is no sensitivity flag or ordinary-publication bypass. |
| Fund | `publishFund`, authorized checker | `review_pending` -> `published` | Requires a different checker, approved action, matching target version/payload hash, disclosure, and initial/current NAV; atomically set `current_published_version_id`. Ordinary current-date NAV/AUM insertion is not this command. |
| Fund | `publishFundVersion`, finance maker/checker | `published` -> `published` | Create a later immutable canonical term version and execute approved `fund.publish_investable_version`; a different checker validates the complete payload and atomically advances `current_published_version_id`. |
| Fund | `pauseFund`, finance admin | `published` -> `paused` | Reason required; blocks new orders, not reads or settlement. |
| Fund | `resumeFund`, finance checker | `paused` -> `published` | Blocking condition resolved; always execute an approved maker-checker action because the fund was published before pause. |
| Fund | `archiveFund`, authorized admin/checker | `draft` or `review_pending` -> `archived`; `published` or `paused` -> `archived` | Draft/review archive needs reason and ordinary permission. A fund that is or was published always requires maker-checker. Existing history remains; archived is terminal. |
| Fund snapshot | `correctPublishedNavOrAum`, finance checker | published revision N -> revision N+1 | Backdating, correction, or supersession of published NAV or AUM data always executes the corresponding approved maker-checker action and appends a revision. Position corrections append a normal authorized revision without maker-checker. Current-date first NAV/AUM publication uses ordinary finance permission. Deletion is forbidden. |
| SIP | `createSip`, eligible owner | none -> `draft` | Published fund, positive minimum amount, valid schedule. |
| SIP | `requestMandate`, owner | `draft` -> `pending_mandate` | Mandate row/outbox created atomically. |
| SIP | `activateSip`, signed provider/system | `pending_mandate` -> `active` | Linked mandate active and owner still eligible. |
| SIP | `pauseSip`, owner/admin | `active` -> `paused` | No installment already in irreversible processing; reason recorded. |
| SIP | `resumeSip`, owner/admin | `paused` -> `active` | Mandate active, fund published, user eligible. |
| SIP | `cancelSip`, owner/admin | `draft`, `pending_mandate`, `active`, or `paused` -> `cancelled` | Reason; lock the mandate and all referencing SIPs. Revoke the mandate only when no other SIP referencing it remains `pending_mandate`, `active`, or `paused`; otherwise detach only the cancelled SIP. |
| SIP | `completeSip`, scheduler | `active` -> `completed` | Duration/installment target reached and no pending installment. Cancelled/completed terminal. |
| Order | `createOrder`, eligible owner/system SIP | none -> `submitted` | Fund published, minimums, idempotency, ownership, and eligibility pass. |
| Order | `beginPayment`, owner/system | `submitted` -> `payment_pending` | Purchase/SIP only; atomically create the payment, first payment attempt, and provider-call outbox event. |
| Order | `confirmPayment`, signed provider event | `payment_pending` -> `payment_confirmed` | Matching succeeded payment, amount/currency/provider evidence valid. |
| Order | `bookOrder`, operations/system | `payment_confirmed` -> `booked` | Applicable NAV exists; create immutable execution, lot, and holding delta atomically. |
| Order | `failPayment`, provider/system | `payment_pending` -> `payment_failed` | All allowed attempts terminal or provider gives terminal failure. |
| Order | `cancelOrder`, owner/admin | `submitted` or `payment_pending` -> `cancelled` | No succeeded payment; cancel pending attempt. |
| Order | `rejectOrder`, operations/compliance | `submitted` or `payment_confirmed` -> `rejected` | Reason. Confirmed funds require refund workflow, so rejection enqueues it. |
| Order | `refundOrder`, provider/system | `payment_confirmed`, `payment_failed`, or `rejected` -> `refunded` | Immutable refund evidence exists for received funds. |
| Order | `reverseBookedOrder`, finance checker | `booked` -> `reversed` | Execute approved `investment_order.reverse`; append one reversal execution linked to the original and exact inverse `holding_lot_movements`, update holding/lot projections atomically, and never edit original execution/movements. The unique reversal link prevents a second reversal. |
| Payment | `createPayment` | none -> `created` | Exactly one payment per order and matching owner/amount/currency. |
| Payment | `sendPaymentToProvider` | `created` -> `provider_pending` | Consume the exact first attempt and provider-call outbox created by `beginPayment`; never create an attempt implicitly and never make the network call inside a transaction. |
| Payment | `succeedPayment` | `provider_pending` -> `succeeded` | Valid deduplicated provider event and exact amount/currency. |
| Payment | `failPayment` | `provider_pending` -> `failed` | Terminal provider failure or attempts exhausted. |
| Payment | `expirePayment` | `created` or `provider_pending` -> `expired` | Database time after expiry and no success evidence. |
| Payment | `refundPayment` | `succeeded` -> `refunded` | Separate immutable refund provider evidence. Terminal states do not reopen. |
| Mandate | `createMandate` | none -> `created` | Eligible owner, SIP ownership, unique live mandate. |
| Mandate | `requestMandateAuthorization` | `created` -> `pending_user_authorization` | Provider request accepted. |
| Mandate | `activateMandate` | `pending_user_authorization` -> `active` | Signed provider evidence and identifiers match. |
| Mandate | `pauseMandate` | `active` -> `paused` | Owner/admin/provider reason. |
| Mandate | `resumeMandate` | `paused` -> `active` | Provider confirms reusable and validity remains. |
| Mandate | `revokeMandate` | `created`, `pending_user_authorization`, `active`, or `paused` -> `revoked` | Owner/admin/provider evidence; terminal. |
| Mandate | `failMandate` | `created` or `pending_user_authorization` -> `failed` | Terminal provider failure. |
| Mandate | `expireMandate` | any nonterminal state -> `expired` | Database date beyond valid-to or provider expiry. |
| Redemption | `submitRedemption` | none -> `submitted` | Eligible owner, positive available units, published/paused fund accepted per policy; create redemption order. |
| Redemption | `reserveRedemptionUnits` | `submitted` -> `units_reserved` | Lock holdings/lots in deterministic ID order; available units sufficient; increment reservations atomically. |
| Redemption | `approveRedemption` | `units_reserved` -> `approved` | Compliance checks; maker-checker at or above the stored `finance_policy_versions.redemption_dual_approval_threshold_paise` (default 10,000,000 paise), using the policy version captured by the request. |
| Redemption | `beginRedemptionSettlement` | `approved` -> `settlement_pending` | Create provider settlement request/outbox. |
| Redemption | `settleRedemption` | `settlement_pending` -> `settled` | Valid settlement evidence; lock and transition the linked redemption `investment_orders` row to `booked`, create its redemption execution/movements, and consume reserved lot/holding units atomically. Request and order cannot settle independently. |
| Redemption | `rejectRedemption` | `submitted` or `units_reserved` -> `rejected` | Reason; release reservations in same transaction. |
| Redemption | `cancelRedemption` | `submitted` or `units_reserved` -> `cancelled` | Owner/admin and settlement not started; release reservations atomically. |
| Provider event | `ingestProviderEvent`, provider endpoint | none -> `received` | Verify signature/raw body first; unique provider/event ID; store encrypted payload/digest. Duplicate returns original acceptance. |
| Provider event | `claimProviderEvent`, worker | `received` -> `processing` | Claim bounded batch with `FOR UPDATE SKIP LOCKED`, lease, and increment attempts. |
| Provider event | `completeProviderEvent`, worker | `processing` -> `processed` | Business transaction succeeded and processed timestamp recorded. |
| Provider event | `retryProviderEvent`, worker | `processing` -> `received` | Retryable categorized error; set backoff `available_at`, release lease. |
| Provider event | `deadLetterProviderEvent`, worker | `processing` -> `dead_lettered` | Permanent error or maximum attempts; alert operations. Manual replay creates an audited new processing attempt, never edits provider identity. |

## 6. Atomic transactions and locking

| Use case | Required lock/order and atomic writes |
| --- | --- |
| Application submit | Acquire advisory idempotency transaction lock; insert application, exactly two consent rows, verification token, delivery, outbox, audit, and completed response row. Catch unique conflicts and map every public duplicate to the exact same generic `202 { accepted: true }`; only authenticated admin/internal commands may receive `ACTIVE_APPLICATION_EXISTS`. No public response contains the application ID, state, or duplicate disposition. |
| Email verification | Lock token, then application; consume token, transition application, and audit. Token use is single-use and does not create an idempotency response row. |
| Application decision | Acquire advisory idempotency lock, then lock application and existing review/user. State must already be `in_review`. Insert review; approval inserts user/invite/delivery/outbox, while rejection inserts required rejection delivery/outbox; update application, audit, and completed response. |
| Invite resend | Lock user then current invite. Revoke it; insert replacement, delivery/outbox, audit. Never leave two pending invites. |
| Email send point of no return | After outbox claim, lock outbox, delivery, then token/invite; cancel before sending if invalid, otherwise atomically set both to `sending` and commit before SES. Result recording is a later transaction; never hold a transaction across the network call. |
| Activation | Lock invite, user, and credential absence. Create credential/session/current refresh token; accept invite and activate user; audit. The single-use invite is the guard; no response-idempotency row stores secrets. |
| Refresh rotation | Lock token by hash, then session. Current rotation atomically moves current refresh and, for web, current CSRF hashes/key versions to previous slots, stores the client-provided rotation ID and derived successors, and starts one 30-second previous-pair grace. A matching prior pair and ID reproduces the result without a write; current refresh + previous CSRF with that ID recovers a partially consumed web response; another ID, expired grace, or older reuse revokes the family. |
| Session suspension/closure | Lock user and credential, then sessions ordered by ID, current refresh tokens, and pending invites; transition/revoke all, null the password hash on closure, and audit atomically. |
| Fund publication/correction | Lock fund, disclosure/snapshot, then approval action. Validate checker and payload hash; publish append-only version and transition fund. |
| Order creation | Acquire advisory idempotency lock, then lock user/compliance prerequisites, fund, and optional SIP. Insert order, audit, and completed response. |
| Begin payment | Lock order; atomically insert payment, attempt number one, provider-call outbox event, transition order to payment pending, and audit. The provider sender consumes that attempt/outbox and creates no implicit attempt. |
| Provider ingestion | Verify outside transaction; rely on unique provider/event identity and insert the event only. Business processing occurs in a worker transaction. |
| Payment success/book | Lock provider event, payment, order, holding, then lots ordered by ID. Write payment/order states, execution, new lot/holding values, notification/outbox/audit. |
| Redemption reserve | Lock order/request, holding, then lots by acquisition date and ID. Increment reserved units on selected lots and holding. |
| Redemption reject/cancel/settle | Same deterministic locks; release or consume reservations, append execution on settlement, and audit. |

Use `READ COMMITTED` plus row locks and unique/check constraints for ordinary
commands. Use `SERIALIZABLE` only for a measured invariant that cannot be
expressed with those mechanisms, and retry serialization failures a bounded
number of times. Set transaction and lock timeouts. Never hold a transaction
open during SES, Razorpay, object-storage, or other network calls.

## 7. Project repository interfaces

These are project-defined interfaces, not claims about Kysely or any third-party
API. `Transaction` means the project alias for a Kysely transaction. Inputs and
outputs are readonly; repository methods return new objects and never mutate
arguments or cached values.

```ts
type ReadonlyDeep<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly ReadonlyDeep<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: ReadonlyDeep<T[Key]> }
      : T

type Row<TableName extends keyof Database> =
  ReadonlyDeep<Selectable<Database[TableName]>>

type Application = Row<"applications">
type ApplicationConsent = Row<"application_consents">
type ConsentDocument = Row<"consent_documents">
type VerificationToken = Row<"verification_tokens">
type ApplicationReview = Row<"application_reviews">
type User = Row<"users">
type UserCredential = Row<"user_credentials">
type ActivationInvite = Row<"activation_invites">
type AuthSession = Row<"auth_sessions">
type AuthRefreshToken = Row<"auth_refresh_tokens">
type Role = Row<"roles">
type Permission = Row<"permissions">
type RolePermission = Row<"role_permissions">
type UserRole = Row<"user_roles">
type ApprovalAction = Row<"approval_actions">
type AuditEvent = Row<"audit_events">
type IdempotencyRecord = Row<"idempotency_records">
type RateLimitWindow = Row<"rate_limit_windows">
type LegalHold = Row<"legal_holds">
type OutboxEvent = Row<"outbox_events">
type EmailDelivery = Row<"email_deliveries">
type EmailProviderEvent = Row<"email_provider_events">
type EmailSuppression = Row<"email_suppressions">

const MAX_QUERY_LIMIT = 100
const MAX_APPLICATION_CONSENTS = 2
const MAX_APPLICATION_REVIEWS = 1
const MAX_EMAIL_DELIVERIES_PER_APPLICATION = 100
const MAX_PROVIDER_EVENT_CLAIM = 100
const MAX_OUTBOX_CLAIM = 100

type CursorInput = ReadonlyDeep<{
  after?: string
  limit: number // validated integer 1..MAX_QUERY_LIMIT
}>
type CursorPage<Item> = ReadonlyDeep<{
  items: readonly Item[]
  nextCursor: string | null
}>
type ApplicationQueueQuery = ReadonlyDeep<CursorInput & {
  states?: readonly Application["state"][]
  createdFrom?: string
  createdTo?: string
}>
type ApplicationQueueItem = ReadonlyDeep<{
  application: Application
  latestReview: ApplicationReview | null
}>
type ApplicationDeliverySummary = ReadonlyDeep<{
  emailDeliveryId: string
  templateKey: string
  recipientMasked: string
  state: EmailDelivery["state"]
  attemptCount: number
  lastErrorCode: string | null
  createdAt: string
  updatedAt: string
}>
type ApplicationConsentDetail = ReadonlyDeep<{
  consent: ApplicationConsent
  kind: ConsentKind
  version: string
}>
type ApplicationDetail = ReadonlyDeep<{
  application: Application
  consents: readonly ApplicationConsentDetail[]
  reviews: readonly ApplicationReview[]
  deliveries: CursorPage<ApplicationDeliverySummary>
}>
type ActiveIdentityCollision = ReadonlyDeep<{
  applicationByEmail: Application | null
  applicationByPhone: Application | null
  userByEmail: User | null
  userByPhone: User | null
}>
type UserWithCredential = ReadonlyDeep<{
  user: User
  credential: UserCredential
}>
type RevokeSessionsResult = ReadonlyDeep<{
  revokedSessionCount: number
  revokedRefreshTokenCount: number
}>
type EmailDeliveryQuery = ReadonlyDeep<CursorInput & {
  states?: readonly EmailDelivery["state"][]
  templateKeys?: readonly string[]
  applicationId?: string
  userId?: string
}>
type RetentionEntityType =
  | "application"
  | "user"
  | "email_delivery"
  | "email_provider_event"
  | "audit_event"
  | "investor_profile"
  | "kyc_case"
  | "risk_assessment"
  | "marketing_lead"
  | "investment_order"
  | "payment"
  | "mandate"
type CleanupRecordType =
  | RetentionEntityType
  | "verification_token"
  | "activation_invite"
  | "auth_session"
  | "auth_refresh_token"
  | "idempotency_record"
  | "outbox_event"
  | "email_provider_event"
  | "email_suppression"
  | "rate_limit_window"
type CleanupCandidateQuery = ReadonlyDeep<{
  recordType: CleanupRecordType
  action: "tombstone" | "erase" | "delete"
  before: string
  after?: string
  limit: number // validated integer 1..MAX_QUERY_LIMIT
}>
type CleanupCandidate = ReadonlyDeep<{
  recordType: CleanupRecordType
  recordId: string
  retentionParentType: RetentionEntityType
  retentionParentId: string
  cursor: string
}>

type Brand<Value, Name extends string> = Value & { readonly __brand: Name }
type ApplicationId = Brand<string, "ApplicationId">
type UserId = Brand<string, "UserId">
type EmailDeliveryId = Brand<string, "EmailDeliveryId">
type DeliveryCorrelationId = Brand<string, "DeliveryCorrelationId">
type ConsentKind = "terms" | "privacy"
type PermissionCode = Brand<string, "PermissionCode">
type CommandContext = ReadonlyDeep<{
  actorUserId: UserId | null
  requestId: string
  expectedVersion?: number
  idempotencyKey?: string
  reasonCode?: string
  reasonDetail?: string
}>
type CreateApplicationInput = ReadonlyDeep<{
  fullName: string
  emailNormalized: string
  phoneE164: string
  consentDocumentIds: readonly string[]
  ipHmac: Uint8Array
  ipHmacKeyVersion: string
  userAgent: string | null
}>
type VerifyEmailCommand = ReadonlyDeep<CommandContext & {
  applicationId: ApplicationId
  tokenId: string
  verifiedAt: string
}>
type StartReviewCommand = ReadonlyDeep<CommandContext & { applicationId: ApplicationId }>
type DecideApplicationCommand = ReadonlyDeep<CommandContext & {
  applicationId: ApplicationId
  decision: "approved" | "rejected"
}>
type WithdrawApplicationCommand = ReadonlyDeep<CommandContext & {
  applicationId: ApplicationId
  applicantRequestEvidence: string
}>
type ApplicationDecisionResult = ReadonlyDeep<{
  application: Application
  review: ApplicationReview
  user: User | null
  activationInvite: ActivationInvite | null
  emailDelivery: EmailDelivery
}>
type RecordConsentAcceptancesInput = ReadonlyDeep<{
  applicationId: ApplicationId
  documentIds: readonly string[]
  acceptedAt: string
  ipHmac: Uint8Array
  ipHmacKeyVersion: string
  userAgent: string | null
}>
type AppendApplicationReviewInput = ReadonlyDeep<{
  applicationId: ApplicationId
  reviewerUserId: UserId
  decision: "approved" | "rejected"
  reasonCode: string
  reasonDetail: string | null
  requestId: string
  idempotencyKey: string
}>
type CreateVerificationTokenInput = ReadonlyDeep<{
  applicationId: ApplicationId | null
  userId: UserId | null
  purpose: VerificationToken["purpose"]
  tokenHash: Uint8Array
  tokenKeyVersion: string
  expiresAt: string
}>
type ConsumeTokenCommand = ReadonlyDeep<CommandContext & {
  tokenId: string
  consumedAt: string
}>
type VerificationSubject = ReadonlyDeep<{
  applicationId?: ApplicationId
  userId?: UserId
  purpose: VerificationToken["purpose"]
  reason: string
}>
type TransitionUserCommand = ReadonlyDeep<CommandContext & {
  userId: UserId
  toState: User["account_state"]
}>
type CreateActivationInviteInput = ReadonlyDeep<{
  userId: UserId
  applicationId: ApplicationId
  tokenHash: Uint8Array
  tokenKeyVersion: string
  expiresAt: string
  createdByUserId: UserId | null
}>
type RevokeInviteCommand = ReadonlyDeep<CommandContext & { inviteId: string }>
type AcceptInviteCommand = ReadonlyDeep<CommandContext & {
  inviteId: string
  acceptedAt: string
}>
type ReplacePasswordCommand = ReadonlyDeep<CommandContext & {
  userId: UserId
  argon2idHash: string
}>
type CreateSessionInput = ReadonlyDeep<{
  userId: UserId
  channel: "native" | "web"
  deviceIdHash: Uint8Array | null
  refreshTokenHash: Uint8Array
  refreshKeyVersion: string
  expiresAt: string
}>
type CreatedSession = ReadonlyDeep<{
  session: AuthSession
  refreshToken: AuthRefreshToken
}>
type RefreshTokenWithSession = ReadonlyDeep<{
  session: AuthSession
  refreshToken: AuthRefreshToken
}>
type RotateRefreshTokenCommand = ReadonlyDeep<CommandContext & {
  sessionId: string
  presentedRefreshHash: Uint8Array
  presentedCsrfHash: Uint8Array | null
  rotationId: string
  now: string
}>
type RotatedSession = ReadonlyDeep<CreatedSession & {
  isReplay: boolean
  csrfTokenHash: Uint8Array | null
}>
type RotateCsrfCommand = ReadonlyDeep<CommandContext & {
  sessionId: string
  currentRefreshHash: Uint8Array
  now: string
}>
type ReplaceWebSessionCommand = ReadonlyDeep<CommandContext & { input: CreateSessionInput }>
type ReplaceNativeSessionCommand = ReadonlyDeep<CommandContext & { input: CreateSessionInput }>
type RevokeSessionFamilyCommand = ReadonlyDeep<CommandContext & { sessionId: string }>
type RevokeWebSessionCommand = RevokeSessionFamilyCommand
type RevokeNativeSessionCommand = RevokeSessionFamilyCommand
type RevokeUserSessionsCommand = ReadonlyDeep<CommandContext & { userId: UserId }>
type IdempotencyScope = ReadonlyDeep<{
  actorScope: string
  actorScopeKeyVersion: string | null
  candidateActorScopes: readonly string[]
  method: string
  routeTemplate: string
  key: string
}>
type CompleteIdempotencyInput = ReadonlyDeep<{
  scope: IdempotencyScope
  requestHash: Uint8Array
  responseStatus: number
  responseBody: unknown
  completedAt: string
  expiresAt: string
}>
type IncrementRateLimitWindowInput = ReadonlyDeep<{
  bucket: string
  keyHash: Uint8Array
  windowStart: string
  expiresAt: string
}>
type RetentionTarget = ReadonlyDeep<{
  entityType: RetentionEntityType
  entityId: string
}>
type PlaceLegalHoldCommand = ReadonlyDeep<CommandContext & {
  target: RetentionTarget
  reason: string
  expiresAt: string | null
}>
type PlaceLegalHoldResult = ReadonlyDeep<{
  hold: LegalHold
  isAlreadyPurged: boolean
}>
type ReleaseLegalHoldCommand = ReadonlyDeep<CommandContext & {
  legalHoldId: string
  releasedAt: string
}>
type NewOutboxEvent = ReadonlyDeep<Omit<OutboxEvent, "id" | "created_at" | "updated_at">>
type ClaimOutboxBatchCommand = ReadonlyDeep<{
  workerId: string
  now: string
  limit: number // validated integer 1..MAX_OUTBOX_CLAIM
}>
type RecordOutboxResultCommand = ReadonlyDeep<{
  outboxEventId: string
  workerId: string
  result: "delivered" | "retryable_failed" | "dead_lettered" | "cancelled"
  errorCode: string | null
  now: string
}>
type NewAuditEvent = ReadonlyDeep<Omit<AuditEvent, "id" | "created_at">>
type CreateEmailDeliveryInput = ReadonlyDeep<
  Omit<EmailDelivery, "id" | "created_at" | "updated_at" | "version">
>
type TransitionEmailDeliveryCommand = ReadonlyDeep<CommandContext & {
  emailDeliveryId: EmailDeliveryId
  toState: EmailDelivery["state"]
  occurredAt: string
  errorCode?: string
}>
type VerifiedSnsInboxInput = ReadonlyDeep<{
  snsMessageId: string
  snsTopicArn: string
  snsType: string
  sesEventType: string | null
  sesMessageId: string | null
  deliveryCorrelationId: DeliveryCorrelationId | null
  payloadCiphertext: Uint8Array
  payloadNonce: Uint8Array
  payloadSha256: Uint8Array
  payloadKeyVersion: string
  expiresAt: string
}>
type UpsertEmailSuppressionInput = ReadonlyDeep<{
  recipientHmac: Uint8Array
  suppressionHmacKeyVersion: string
  reason: "bounce" | "complaint"
  sourceEventId: string
}>

interface UnitOfWork {
  execute<Result>(
    operation: (tx: Transaction) => Promise<ReadonlyDeep<Result>>,
  ): Promise<ReadonlyDeep<Result>>
}

interface ApplicationRepository {
  createSubmission(tx: Transaction, input: CreateApplicationInput): Promise<Application>
  lockById(tx: Transaction, applicationId: ApplicationId): Promise<Application | null>
  findQueuePage(
    tx: Transaction,
    query: ApplicationQueueQuery,
  ): Promise<CursorPage<ApplicationQueueItem>>
  findDetail(
    tx: Transaction,
    input: Readonly<{ applicationId: ApplicationId; deliveryQuery: CursorInput }>,
  ): Promise<ApplicationDetail | null>
  findActiveIdentityCollisions(
    tx: Transaction,
    input: Readonly<{ emailNormalized: string; phoneE164: string }>,
  ): Promise<ActiveIdentityCollision>
  markEmailVerified(tx: Transaction, command: VerifyEmailCommand): Promise<Application>
  startReview(tx: Transaction, command: StartReviewCommand): Promise<Application>
  withdraw(tx: Transaction, command: WithdrawApplicationCommand): Promise<Application>
  recordDecision(tx: Transaction, command: DecideApplicationCommand): Promise<ApplicationDecisionResult>
}

interface ConsentRepository {
  findCurrentDocuments(
    tx: Transaction,
    kinds: readonly ConsentKind[],
  ): Promise<readonly ConsentDocument[]>
  recordAcceptances(
    tx: Transaction,
    input: Readonly<RecordConsentAcceptancesInput>,
  ): Promise<readonly ApplicationConsent[]>
  findForApplication(
    tx: Transaction,
    applicationId: ApplicationId,
  ): Promise<readonly ApplicationConsentDetail[]> // joins each immutable referenced document; hard maximum MAX_APPLICATION_CONSENTS
}

interface ApplicationReviewRepository {
  append(
    tx: Transaction,
    input: Readonly<AppendApplicationReviewInput>,
  ): Promise<ApplicationReview>
  findForApplication(
    tx: Transaction,
    applicationId: ApplicationId,
  ): Promise<readonly ApplicationReview[]> // hard maximum MAX_APPLICATION_REVIEWS
}

interface VerificationTokenRepository {
  create(tx: Transaction, input: CreateVerificationTokenInput): Promise<VerificationToken>
  lockByHash(tx: Transaction, tokenHash: Uint8Array): Promise<VerificationToken | null>
  consume(tx: Transaction, command: ConsumeTokenCommand): Promise<VerificationToken>
  revokeOutstanding(tx: Transaction, subject: VerificationSubject): Promise<readonly VerificationToken[]>
}

interface UserRepository {
  createFromApprovedApplication(tx: Transaction, application: Application): Promise<User>
  lockById(tx: Transaction, userId: UserId): Promise<User | null>
  lockByNormalizedEmailWithCredential(
    tx: Transaction,
    emailNormalized: string,
  ): Promise<UserWithCredential | null>
  transitionAccount(tx: Transaction, command: TransitionUserCommand): Promise<User>
}

interface ActivationInviteRepository {
  lockCurrent(tx: Transaction, userId: UserId): Promise<ActivationInvite | null>
  lockByTokenHash(tx: Transaction, tokenHash: Uint8Array): Promise<ActivationInvite | null>
  revokeCurrent(tx: Transaction, command: RevokeInviteCommand): Promise<ActivationInvite>
  create(tx: Transaction, input: CreateActivationInviteInput): Promise<ActivationInvite>
  accept(tx: Transaction, command: AcceptInviteCommand): Promise<ActivationInvite>
}

interface CredentialRepository {
  exists(tx: Transaction, userId: UserId): Promise<boolean>
  create(tx: Transaction, userId: UserId, argon2idHash: string): Promise<UserCredential>
  replacePassword(tx: Transaction, command: ReplacePasswordCommand): Promise<UserCredential>
}

interface AuthSessionRepository {
  create(tx: Transaction, input: CreateSessionInput): Promise<CreatedSession>
  lockActiveNativeByUserAndDeviceHash(
    tx: Transaction,
    input: Readonly<{ userId: UserId; deviceIdHash: Uint8Array }>,
  ): Promise<AuthSession | null>
  lockActiveBySid(tx: Transaction, sid: string): Promise<AuthSession | null>
  lockByRefreshTokenHash(tx: Transaction, hash: Uint8Array): Promise<RefreshTokenWithSession | null>
  replaceWebSession(tx: Transaction, command: ReplaceWebSessionCommand): Promise<CreatedSession>
  replaceNativeSession(tx: Transaction, command: ReplaceNativeSessionCommand): Promise<CreatedSession>
  rotate(tx: Transaction, command: RotateRefreshTokenCommand): Promise<RotatedSession>
  rotateCsrf(
    tx: Transaction,
    command: Readonly<RotateCsrfCommand>,
  ): Promise<AuthSession>
  revokeFamily(tx: Transaction, command: RevokeSessionFamilyCommand): Promise<AuthSession>
  revokeWebSession(tx: Transaction, command: RevokeWebSessionCommand): Promise<AuthSession>
  revokeNativeSession(tx: Transaction, command: RevokeNativeSessionCommand): Promise<AuthSession>
  revokeAllForUser(tx: Transaction, command: RevokeUserSessionsCommand): Promise<RevokeSessionsResult>
}

interface RbacRepository {
  hasPermission(
    tx: Transaction,
    userId: UserId,
    permission: PermissionCode,
  ): Promise<boolean>
  findActiveRolePage(
    tx: Transaction,
    input: Readonly<{ userId: UserId; page: CursorInput }>,
  ): Promise<CursorPage<Role>>
  findActivePermissionPage(
    tx: Transaction,
    input: Readonly<{ userId: UserId; page: CursorInput }>,
  ): Promise<CursorPage<Permission>>
}

interface IdempotencyRepository {
  tryAcquireTransactionLock(
    tx: Transaction,
    scope: Readonly<IdempotencyScope>,
  ): Promise<boolean>
  findCompleted(
    tx: Transaction,
    scope: Readonly<IdempotencyScope>,
  ): Promise<IdempotencyRecord | null>
  insertCompleted(
    tx: Transaction,
    input: Readonly<CompleteIdempotencyInput>,
  ): Promise<IdempotencyRecord>
}

interface RateLimitRepository {
  incrementWindow(
    tx: Transaction,
    input: Readonly<IncrementRateLimitWindowInput>,
  ): Promise<RateLimitWindow>
}

interface LegalHoldRepository {
  lockRetentionTarget(
    tx: Transaction,
    target: RetentionTarget,
  ): Promise<Readonly<{ exists: boolean; isAlreadyPurged: boolean }>>
  place(
    tx: Transaction,
    command: PlaceLegalHoldCommand,
  ): Promise<PlaceLegalHoldResult>
  release(
    tx: Transaction,
    command: ReleaseLegalHoldCommand,
  ): Promise<LegalHold>
  findActiveForEntities(
    tx: Transaction,
    entities: readonly Readonly<{
      entityType: RetentionEntityType
      entityId: string
    }>[], // hard maximum MAX_QUERY_LIMIT
  ): Promise<readonly LegalHold[]>
}

interface RetentionRepository {
  findEligibleCleanupPage(
    tx: Transaction,
    query: CleanupCandidateQuery,
  ): Promise<CursorPage<CleanupCandidate>>
  applyCleanupIfStillEligible(
    tx: Transaction,
    command: Readonly<CleanupCandidate & { expectedPolicyVersion: string }>,
  ): Promise<Readonly<{ isApplied: boolean; isHeld: boolean }>>
}

interface OutboxRepository {
  enqueue(tx: Transaction, event: NewOutboxEvent): Promise<OutboxEvent>
  claimBatch(tx: Transaction, command: ClaimOutboxBatchCommand): Promise<readonly OutboxEvent[]>
  recordResult(tx: Transaction, command: RecordOutboxResultCommand): Promise<OutboxEvent>
}

interface AuditRepository {
  append(tx: Transaction, event: NewAuditEvent): Promise<AuditEvent>
}

interface EmailDeliveryRepository {
  create(
    tx: Transaction,
    input: Readonly<CreateEmailDeliveryInput>,
  ): Promise<EmailDelivery>
  lockById(tx: Transaction, deliveryId: EmailDeliveryId): Promise<EmailDelivery | null>
  transition(
    tx: Transaction,
    command: Readonly<TransitionEmailDeliveryCommand>,
  ): Promise<EmailDelivery>
  findPage(
    tx: Transaction,
    query: EmailDeliveryQuery,
  ): Promise<CursorPage<EmailDelivery>>
  findPageForApplication(
    tx: Transaction,
    input: Readonly<{
      applicationId: ApplicationId
      page: CursorInput
    }>,
  ): Promise<CursorPage<EmailDelivery>> // limit capped at MAX_EMAIL_DELIVERIES_PER_APPLICATION
}

interface EmailProviderEventRepository {
  insertVerified(
    tx: Transaction,
    event: Readonly<VerifiedSnsInboxInput>,
  ): Promise<Readonly<{ eventId: string; isDuplicate: boolean }>>
  lockReceivedBatch(
    tx: Transaction,
    input: Readonly<{ limit: number; now: string }>, // limit 1..MAX_PROVIDER_EVENT_CLAIM
  ): Promise<readonly EmailProviderEvent[]>
  lockUnmatchedBatch(
    tx: Transaction,
    input: Readonly<{ limit: number; now: string }>, // limit 1..MAX_PROVIDER_EVENT_CLAIM
  ): Promise<readonly EmailProviderEvent[]>
  markProcessed(
    tx: Transaction,
    input: Readonly<{ eventId: string; processedAt: string }>,
  ): Promise<EmailProviderEvent>
  markIgnored(
    tx: Transaction,
    input: Readonly<{ eventId: string; processedAt: string }>,
  ): Promise<EmailProviderEvent>
  markUnmatched(
    tx: Transaction,
    input: Readonly<{ eventId: string; processedAt: string }>,
  ): Promise<EmailProviderEvent>
  reconcileUnmatched(
    tx: Transaction,
    input: Readonly<{
      eventId: string
      emailDeliveryId: EmailDeliveryId
      processedAt: string
    }>,
  ): Promise<EmailProviderEvent>
}

interface EmailSuppressionRepository {
  findAnyActive(
    tx: Transaction,
    candidates: readonly Readonly<{
      recipientHmac: Uint8Array
      suppressionHmacKeyVersion: string
    }>[],
  ): Promise<EmailSuppression | null>
  upsertFromSafetyEvent(
    tx: Transaction,
    input: Readonly<UpsertEmailSuppressionInput>,
  ): Promise<EmailSuppression>
}
```

Later slices add focused `KycCaseRepository`, `RiskAssessmentRepository`,
`FundRepository`, `SipRepository`, `OrderRepository`, `HoldingRepository`,
`PaymentRepository`, `MandateRepository`, `RedemptionRepository`, and
`ProviderEventRepository` with the same `lock`, guarded transition, immutable
return, and caller-owned transaction conventions. Repositories do not begin or
commit transactions and do not call providers. Bulk revocation uses one guarded
set-based update and returns counts only; it never materializes an unbounded
session collection.

## 8. Migration 001-008 disposition matrix

`Keep` means retain semantics in the canonical target, not retain the current
DDL unchanged. `Merge` means backfill into the named target and remove after
all readers/writers switch. `Remove` means no canonical replacement is needed.
`Postpone` means out of MVP and must not block removal of JSON parity.

| Migration | Current object | Decision | Canonical disposition |
| --- | --- | --- | --- |
| 001 | `user_role` enum | Remove | Replace scalar role with `roles`, `permissions`, `role_permissions`, and `user_roles`. |
| 001 | `user_status` enum | Remove | Split into application, account, KYC, and risk enums. |
| 001 | `review_status` enum | Remove | Replace with domain-specific application/KYC/risk states. |
| 001 | `risk_category` enum | Keep | Recreate canonical values for `risk_assessments`. |
| 001 | `users` | Merge | Backfill only approved identities into canonical `users`; move credentials, roles, KYC, and risk out. |
| 001 | `device_sessions` | Merge | Replace with `auth_sessions` plus replay-detecting `auth_refresh_tokens`. |
| 001 | `kyc_profiles` | Merge | Split into encrypted `investor_profiles`, `kyc_cases`, and `kyc_documents`. |
| 001 | `risk_profiles` | Merge | Replace with versioned `risk_assessments`. |
| 001 | `kyc_review_events` | Merge | Backfill append-only `kyc_reviews` and redacted `audit_events`. |
| 001 | `admin_audit_logs` | Merge | Replace with append-only `audit_events`; prohibit updates/deletes. |
| 002 | `product_status` enum | Merge | Normalize to `fund_state`; `coming_soon` is presentation/config, not canonical lifecycle. |
| 002 | `product_risk_level` enum | Keep | Rename/recreate as `fund_risk_level`. |
| 002 | `products` | Merge | Merge into the single authoritative `funds` table using paise amounts. |
| 002 | `product_disclosures` | Merge | Replace with `fund_disclosure_versions`. |
| 002 | `product_holdings` | Merge | Rename semantics to `fund_positions`; these are fund assets, not client holdings. |
| 003 | `investment_plan_type` enum | Remove | SIP only remains a plan; one-time intent becomes an order. |
| 003 | `investment_plan_status` enum | Remove | Replace with the smaller `sip_state` and order/payment lifecycles. |
| 003 | `transaction_type` enum | Merge | Map intent to `order_type` and booked result to `execution_type`. |
| 003 | `transaction_status` enum | Merge | Replace with `order_state`; immutable results live in executions. |
| 003 | `payment_status` enum | Merge | Replace with canonical `payment_state`. |
| 003 | `mandate_status` enum | Merge | Replace with canonical `mandate_state`; remove `not_required`/`setup_required` pseudo-states. |
| 003 | `statement_status` enum | Postpone | Reintroduce only with generated statements. |
| 003 | `investment_plans` | Merge | SIP rows become `sip_plans`; one-time rows become `investment_orders`. |
| 003 | `transactions` | Merge | Intent becomes `investment_orders`; allotted facts become `investment_executions`. |
| 003 | `mandates` | Merge | Backfill canonical ownership-constrained `mandates`. |
| 003 | `payments` | Merge | Split aggregate `payments` from repeatable `payment_attempts`; convert rupees to paise exactly. |
| 003 | `payment_webhook_events` | Merge | Replace with unified `provider_events`. |
| 003 | `mandate_webhook_events` | Merge | Replace with unified `provider_events`. |
| 003 | `ledger_entries` | Remove | It is not a balanced accounting ledger; authoritative executions/payments/holdings replace its product behavior. |
| 003 | `statements` | Postpone | Generated documents are out of MVP; retain source financial records. |
| 003 | commented `portfolio_snapshots` / `holding_snapshots` | Remove | No deployed objects; holdings/lots are ownership truth and performance cache is postponed. |
| 004 | `app_config_versions` | Keep | Retain versioned presentation/feature configuration after removing embedded products/funds. |
| 005 | `funds` | Merge | Merge with `products` into canonical `funds`; remove embedded AUM columns. |
| 005 | `capital_transactions` | Remove | No fake ledger; use published AUM snapshots and authoritative payment/execution records. |
| 005 | `redemption_requests` | Merge | Replace with ownership-constrained canonical redemption requests and orders. |
| 005 | `withdrawal_previews` | Remove | Recompute previews from current authoritative lots; do not persist as ownership evidence. |
| 005 | `sip_control_requests` | Merge | Express accepted controls as SIP commands/audit events; pending high-risk actions use `approval_actions`. |
| 005 | `support_tickets` | Postpone | Support is out of MVP; design later without retaining JSON parity. |
| 005 | `support_ticket_messages` | Postpone | Same support-domain postponement. |
| 005 | `receipts` | Remove | Generated receipts postponed; use audit plus authoritative financial evidence. |
| 005 | `timeline_events` | Remove | Derive timeline projections from orders, executions, payments, notifications, and safe audit events. |
| 005 | `notifications` | Keep | Recreate with restricted ownership and allowlisted payload. |
| 005 | `orders` | Merge | Merge with transaction intents into `investment_orders`. |
| 005 | `faqs` | Merge | Backfill only into versioned `content_items(kind='faq')`; no canonical `faqs` table remains. |
| 005 | `disclosures` | Merge | Fund disclosures go to versions; general legal disclosures go to versioned site content. |
| 005 | `static_pages` | Keep | Move to versioned site-content publication. |
| 005 | `portfolio_snapshots` | Remove | Not ownership truth; a performance/read cache may be designed later. |
| 006 | `users.username` and lowercase unique index | Remove | Authentication uses normalized email; no username in canonical identity. |
| 007 | `courses` | Keep | Recreate as typed, versioned landing content with paise price and publication state. |
| 007 | `plans` | Merge | Rename to `membership_plans` to avoid collision with SIP terminology. |
| 008 | `request_idempotency` | Merge | Replace with completed-only scoped `idempotency_records`, advisory transaction locks, request-hash conflict detection, and explicit retention; there are no processing/lease rows. |

After all runtime readers/writers use canonical repositories, verify counts and
money conversions, remove compatibility views/adapters, archive migrations
001-008 as historical reference, and generate one clean baseline from the
verified target schema. There is no production-data constraint, but backfill
scripts remain deterministic and testable so development fixtures can validate
the cutover.

## 9. Sensitive data, deletion, and operational enforcement

The retention trigger is the named database timestamp, not wall time inferred
by a client. `later(a,b)` means the non-null greater timestamp. A legal-hold row
for an entity suspends every cleanup below.

| Records | Retention trigger and action |
| --- | --- |
| Applications, consents, reviews | Evidence remains seven years from `decided_at`/`withdrawn_at`; if never decided, seven years from `submitted_at`, or `created_at` for an unverified row. Unverified direct PII is tombstoned 30 days from `created_at`; rejected/withdrawn direct PII is tombstoned 180 days from `decided_at`/`withdrawn_at`; an approved application's direct PII is tombstoned with its linked closed user 180 days from `users.closed_at`. Normalized identifiers become unique irreversible tombstones so the original email/phone can be reused. Consent/review/audit links remain pseudonymous for the seven-year evidence period. |
| Consent documents, published catalog/content | Indefinite from publication; never delete through application runtime. |
| Verification tokens | 90 days from `later(consumed_at, revoked_at, expires_at)`; physically delete token row. |
| Users and credentials | `closeUser` nulls `password_hash` atomically with closure/session/invite revocation. Unless held, tombstone direct user name/email/phone and linked approved-application PII 180 days after `closed_at`; replace normalized identifiers with unique irreversible tombstones to permit reuse, and retain the pseudonymous user ID for the longest linked consent/audit/compliance/financial evidence period. |
| Activation invites and email deliveries | Seven years from latest terminal evidence timestamp, including cancellation; null recipient/failure ciphertext, nonce, and encryption-key-version columns at expiry and retain masked/HMAC/digest/audit evidence. |
| Active email suppressions | Indefinite while active. Lifted rows expire seven years from `lifted_at`; permanent-bounce rows are never lifted. |
| Unmatched email provider events | Seven days from `received_at`; subscription confirmation records one year; matched events follow their delivery, and a suppression source event remains while that suppression is active. |
| Auth sessions/refresh tokens | 180 days from `revoked_at` or `expired_at`; delete session and cascade its refresh rows. |
| Public/admin-financial idempotency | Respectively 24 hours/seven days from `completed_at`; bounded physical deletion by `expires_at`. |
| Delivered/cancelled/dead-letter outbox | Respectively 90 days/90 days/one year from `delivered_at`, `cancelled_at`, or terminal `updated_at`; physically delete when no retained evidence FK requires it. |
| Rate-limit windows | Window expiry plus 24 hours, represented by `expires_at`; bounded physical deletion using the cleanup index. |
| Legal holds | Retain released/expired hold metadata for seven years from `released_at` or `expires_at`; never let its cleanup re-enable a previously blocked retention mutation without a fresh eligibility check. |
| Compliance | Eight years from `users.closed_at`, or indefinitely while the relationship is open; purge encrypted PII fields from the primary database only after the trigger. |
| Financial aggregates/evidence and approval actions | Ten years from the later of aggregate terminal time and `users.closed_at`; append-only evidence remains until then. |
| Audit events | Onboarding/security events: seven years from the later of `occurred_at` and related `users.closed_at`; financial events: ten years on the same trigger. Events remain append-only until expiry. |
| Raw financial-provider ciphertext | Seven years from `processed_at`, then purge encrypted payload fields from the primary database; retain digest/outcome for the ten-year financial period. |
| Notifications | 24 months from `created_at`; physically delete. |
| Unconverted marketing-lead PII | 24 months from `created_at`; purge encrypted fields from the primary database and close the tombstone. Converted leads follow application retention. |

- Encrypt PAN, Aadhaar-derived data, date of birth, address, KYC files, bank
  details, and raw provider payloads with managed keys and recorded key version.
  Only masked last-four values may appear in authorized operational views.
- Hash high-entropy tokens with SHA-256 before storage; use Argon2id only for
  passwords. Compare hashes in constant time. Token values appear only once at
  creation and are excluded from logs and outbox payload inspection.
- Encrypt backups, restrict database roles by migration/application/worker/read
  duties, and revoke direct table access from frontend identities.
- `ON DELETE RESTRICT` is the default for identity, consent, compliance,
  catalog history, financial, provider, approval, and audit records. `CASCADE`
  is allowed only for ephemeral refresh-token cleanup after the parent session
  retention expires; application code performs that deletion explicitly.
- Retention jobs operate in bounded batches, emit metrics and an audit event,
  and pseudonymize before deletion when relational evidence must remain.
- Database triggers reject `UPDATE`/`DELETE` on audit events, executions,
  reviews, consents, published disclosures/NAV/AUM versions, and processed
  provider evidence for the application role. Migration/retention roles are
  separately controlled.
- Every JSONB field has an object/array check plus a versioned boundary schema.
  JSONB is never used to hide ownership IDs, state, money, timestamps, or
  relationships that require constraints.

## 10. Acceptance checks

- Recreate an empty PostgreSQL database from the additive schema and from the
  eventual clean baseline; compare generated schema dumps.
- Exercise every check, unique/partial index, composite ownership FK, and delete
  restriction with PostgreSQL integration tests.
- Race duplicate application submissions, two admin decisions, invite resend
  against activation, two refresh rotations, provider duplicates, holding
  updates, and redemption reservations. Exactly one valid transition wins.
- Assert submission records the two referenced current consent documents and IP
  HMAC/key version, and each referenced document resolves immutable Markdown,
  unique public path, and matching SHA-256; create no `application_details`
  row and expose no public application UUID. New and duplicate-active public
  submissions return the identical generic 202. Approval/rejection must
  conflict until start-review commits.
- Prove a lost web-refresh response, reload, and concurrent tabs reuse the
  client-generated rotation ID and previous refresh/CSRF pair to reproduce the
  byte-identical successor without incrementing generation. A different ID,
  missing/incorrect previous CSRF, grace expiry, or older reuse revokes the
  family; CSRF recovery accepts current refresh only and cannot bypass reuse.
- Prove advisory-lock idempotency has completed rows only, concurrent in-flight
  requests map to `IDEMPOTENCY_IN_PROGRESS`, and a crash releases the lock and
  leaves no row.
- Exercise required rejection delivery, all eight email attempts, revoked
  invite send races, signed/deduplicated SNS events, late bounce/complaint
  suppression across active HMAC key versions, AES-GCM AAD/tag failures,
  nullable-envelope erasure, and masked-only admin projections. Prove outbox is
  the sole lease/due/retry owner, pre-sending revocation uses the exact token or
  invite cancellation code, the committed sending point survives a worker
  crash without an open transaction, post-sending revocation leaves any arriving
  link harmless, and Delivery Delay never re-enqueues.
- Exercise the closed maker-checker set: all investable fund/term publications,
  published fund resume/archive, NAV/AUM correction, booked-order reversal,
  threshold redemption, and RBAC permission changes. Prove position correction
  and every listed ordinary action cannot create an approval action.
- Prove immutable execution reversal and holding-lot movements, exact
  round-half-even unit/paise conversions, deterministic residual cost-basis
  allocation, redemption request/order atomic booking, and shared-mandate SIP
  cancellation.
- Prove rollback for every atomic boundary by injecting a failure after each
  write; no email/provider call occurs from an open transaction.
- Verify query plans use the admin queue, user history, token expiry, outbox,
  provider inbox, and operations queue indexes.
- Prove every queue/detail/delivery/retention repository query uses an encoded
  keyset cursor and a validated limit no greater than 100; reject unbounded
  scans, and enforce the smaller consent/review/provider-claim bounds.
- Run retention/anonymization fixtures and assert prohibited sensitive fields
  never appear in logs, audits, responses, notifications, or outbox payloads.
  Assert unverified/rejected-or-withdrawn/closed PII triggers at 30/180/180
  days, credential hash removal occurs at closure, linked approved-application
  identifiers are tombstoned with closed users and become reusable, and active
  legal holds exclude exact children and declared parents. Cover released,
  expired, unrelated, and hold-placement races under row lock; consent/audit
  evidence remains pseudonymous for seven years.
- Race rate-limit increments through the atomic upsert, verify the returned
  count enforces the boundary, and prove cleanup uses `expires_at` without
  storing raw subjects.
- Maintain at least 80 percent test coverage, with branch-focused tests for
  transition guards, concurrency conflicts, ownership, money/decimal handling,
  idempotency, token replay, and worker retries.


## Related notes (Obsidian graph)

- Master plan: [[plans/01-postgresql-typescript-rearchitecture-plan|Rearchitecture plan]]
- Companion specs: [[specifications/02-product-architecture-decisions|02 · Product & architecture]] · [[specifications/04-api-security-test-specification|04 · API/security/email/test]] · [[specifications/05-system-tooling-diagrams|05 · System/tooling/contracts]]
- Rules & decisions: [[WORKING_MODEL|Working model]] · [[decisions/RISKS_AND_DECISIONS|Risks & decisions]]
- Implements as schema tasks: [[logs/BE-021-later-domain-schema-1|BE-021 later-domain schema]]
- Home: [[README|Session 1 home]]

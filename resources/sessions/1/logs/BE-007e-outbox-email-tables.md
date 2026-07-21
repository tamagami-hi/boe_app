# BE-007e Phase Log: Outbox / Email Delivery Tables

Status: `DONE`

## Objective And Dependency Closure

- Objective: additive transactional-outbox and email delivery tables proven on
  empty PostgreSQL 16.
- Dependencies: BE-007d (`DONE`). Parent BE-007 stays in progress.
- Normative sources: `specifications/03` §2.1 (`outbox_state`,
  `email_delivery_state`), §3.3 (`outbox_events`, `email_deliveries`,
  `email_provider_events`, `email_suppressions`).
- Dominant risk: wrong outbox lease/claim invariants and email PII envelope /
  template-subject rules.
- Intentional behavior change: none (additive).

## Atomic Units

- [x] Author `013_canonical_outbox_email.sql` (2 enums + 4 tables + constraints).
- [x] Extend the canonical-schema integration test: outbox dedup + lease group,
      template<->subject FK matrix, recipient HMAC size + all-or-null envelope,
      SNS message-id uniqueness + unmatched commit, suppression PK + lift group.
- [x] `npm run check` green; `npm run test:integration` green (13/13).
- [x] Records updated; commit/push.

## Replacement And Deletion Map

| New | Superseded JS deleted | Guard |
|---|---|---|
| `db/migrations/013_canonical_outbox_email.sql` | none (additive) | integration assertions on real PG |

## Research And Reuse

- Reused BE-005 runner + BE-004 harness; canonical migrations applied in
  isolation (versions `>= 009`). Composite FKs reuse the `(id, application_id)`
  key on `verification_tokens` (009) and `(id, user_id)` key on
  `activation_invites` (010) already created for exactly this ownership rule.

## RED Evidence

- Honest note: as with BE-007a/b/c/d, no separate failing run was captured; the
  migration and its assertions were authored together and validated GREEN on the
  first integration run (13/13).
- Correctness care: Postgres CHECK constraints pass on NULL, so the AES-256-GCM
  envelope groups (recipient / failure-detail / provider payload), the outbox
  lease-field group, and the suppression lift group are written as explicit
  all-null-or-all-present disjunctions so a partial envelope/lease/lift is
  rejected rather than silently accepted.

## Implementation And Decisions

- `013_canonical_outbox_email.sql` adds enums `outbox_state`
  (`pending`/`processing`/`sending`/`delivered`/`retryable_failed`/
  `dead_lettered`/`cancelled`) and `email_delivery_state`
  (`queued`/`sending`/`sent`/`delivered`/`retryable_failed`/`permanent_failed`/
  `cancelled`), and 4 tables:
  - `outbox_events` — full event envelope, unique `deduplication_key`, nonblank
    topic/event/aggregate labels, positive `event_version`, object payload,
    nonnegative attempts, `occurred_at <= created_at`; lease fields
    (`locked_at`/`locked_by`/`lease_expires_at`) are all-present-or-all-null and
    permitted only in `processing`/`sending` with `lease_expires_at > locked_at`;
    `cancelled_at` only in `cancelled`. Claim index over
    `(available_at, created_at, id) WHERE state IN ('pending','retryable_failed')`
    and lease-recovery index over `(lease_expires_at, id) WHERE state IN
    ('processing','sending')`.
  - `email_deliveries` — subject required (application or user); template limited
    to `verify_email`/`activation_invite`/`application_rejected` with the exact
    template<->reference matrix (verify needs its verification-token FK only,
    activation needs its invite FK only, rejection needs both null); composite
    FKs `(verification_token_id, application_id)` and `(activation_invite_id,
    user_id)` prevent mixing a token/invite with a foreign subject; outbox FK
    required while `queued`/`sending`/`retryable_failed`; recipient HMAC 32 bytes;
    attempts 0-8; SES IDs <=512 chars; monotonic evidence timestamps; recipient
    and failure-detail PII envelopes are all-or-null with a 12-byte nonce, a
    >=16-byte GCM-tagged ciphertext, and are null after `erased_at`. Unique
    `ses_message_id` where non-null; admin/subject history indexes only (the
    outbox row exclusively owns claim/lease state).
  - `email_provider_events` — unique `sns_message_id`; closed SNS-type and
    optional SES-event-type sets; text `state` limited to
    `received|processed|ignored|unmatched`; 32-byte digest; `expires_at >
    received_at`; payload envelope all-or-null with 12-byte nonce and null after
    erasure; a valid-but-unknown `delivery_correlation_id` still commits (signed
    correlation evidence, not a FK) and only a resolved `email_delivery_id` uses
    the delivery FK. Received/unmatched/ses-message/expiry indexes.
  - `email_suppressions` — PK `(recipient_hmac, suppression_hmac_key_version)`;
    32-byte HMAC; nonblank key version; reason `bounce`/`complaint`; lift fields
    all-null or all-present with a 10-1000 char reason; source FK to a provider
    event.
- Decisions/deferrals: the worker claim/lease state machine, backoff schedule,
  AES-256-GCM envelope operations, SNS signature validation, and the exact
  "masked recipient contains no complete address" rule are command/worker/Zod-
  enforced (DB rejects blank + control chars only, consistent with earlier
  slices). The §2.1 `provider_event_state` enum is not created here because the
  `email_provider_events.state` column is specified as `text` with its own
  `received|processed|ignored|unmatched` set; it will land with the table that
  consumes it. Repositories -> BE-007f; bootstrap seed -> BE-007g.

## GREEN Validation

| Gate | Command | Result |
|---|---|---|
| Unit check | `npm run check` | green (typecheck + lint + coverage 87.69% + build + smoke) |
| Integration | `npm run test:integration` | 13/13 vs PostgreSQL 16 |

## Reviews

- Code + security (focused inline review): outbox dedup + lease integrity, the
  template<->subject FK matrix, recipient-HMAC sizing, all-or-null PII envelopes
  (recipient / failure / provider payload) with GCM-tagged ciphertext and
  post-erasure nulling, SNS message-id uniqueness with unmatched-correlation
  commit, and suppression PK + lift grouping are all verified by integration
  assertions. Suppression HMAC is keyed by a dedicated versioned key column and
  never shares an IP/rate-limit/token/encryption key. Additive; no
  CRITICAL/HIGH/MEDIUM.

## Metrics

- Schema SQL added: `013_canonical_outbox_email.sql` (4 tables, 2 enums).
- Test TS added: 1 integration test (suite 12 -> 13).
- Production JS/JSX deleted: 0 (additive). Backend authored JS backlog unchanged
  at 83 files.

## Risk, Rollback, And Resume

- Residual risk: schema not consumed by a route/worker yet; encryption-envelope
  and SNS validation are command-enforced and unproven until BE-007f/BE-008+.
- Rollback shape: revert the BE-007e commit; remove `013`.
- Commit/push: conventional commit on `ts-migration/backend`; PR #1 updated.
- Exact next action: BE-007f — Kysely repository interfaces (spec `03` §7).

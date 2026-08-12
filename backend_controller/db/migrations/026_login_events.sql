-- 026_login_events.sql
--
-- Per-user login tracking.
--
-- Before this migration, the only trace of a sign-in was one `audit_events` row
-- with command `auth.native_login`, written on success only. That is not enough
-- to answer the questions an operator actually asks:
--
--   * when did this investor last sign in, and from what?
--   * is this account being hammered with wrong passwords?
--   * did a sign-in fail because the password was wrong, or because the account
--     is suspended, or because the address does not exist at all?
--
-- None of those are answerable from a success-only log with no IP and no user
-- agent (`audit_events.ip_address` / `user_agent` exist but were never written).
--
-- `auth_login_events` is append-only and deliberately separate from
-- `audit_events`:
--
--   1. It records *failures*, which are not state transitions and have no
--      entity/version to attach to an audit row.
--   2. It is written on the failure path with no surrounding transaction and no
--      row lock, so a burst of wrong-password attempts against one account
--      cannot serialize behind anything. `audit_events` rows are written inside
--      the command's transaction by design; these must not be.
--   3. `user_id` is nullable: an attempt against an address that does not exist
--      is exactly the event worth keeping, and it has no user to point at. The
--      submitted address is stored normalised so those attempts are still
--      groupable.
--
-- What is NOT here, on purpose:
--
--   * No counter column on `users`. `users.version` is the optimistic-concurrency
--     token behind the admin `If-Match` preconditions; bumping the row on every
--     sign-in would invalidate a console snapshot the operator is holding, so a
--     `last_login_at` column on `users` would trade a real correctness property
--     for a denormalised convenience. Last sign-in is read from this table.
--   * No lockout enforcement. `user_credentials.locked_until` /
--     `failed_attempt_count` remain unused by code. This migration makes lockout
--     *decidable* (the attempt history now exists); turning it on is a policy
--     choice with a support cost and is left to a separate decision.
--   * No password, no password hash, no submitted secret of any kind.
--
-- Retention: none yet, deliberately, and this is a known debt. At the current
-- client base a row per sign-in attempt is a few thousand rows a year, so the
-- table does not need pruning to stay healthy; what it needs is a decision about
-- how long sign-in provenance (address, user agent) should be kept, which is a
-- privacy question rather than a capacity one. `auth_login_events_queue_idx`
-- makes an `occurred_at < now() - interval` delete cheap when that decision is
-- made.

-- No BEGIN/COMMIT here: scripts/migrate.ts wraps each file in one transaction
-- together with its `schema_migrations` row, and committing early inside the file
-- would split those apart — the DDL could land without being recorded, making the
-- migration unrepeatable on the next run.

-- Why a sign-in attempt ended.
--
--   * `password_changed` is the narrow race the login command detects explicitly:
--     the credential was rotated between the password verification and the
--     session write.
--   * `not_authorized` is a correct password with no admin role presented at the
--     admin console. The response is still INVALID_CREDENTIALS — the console must
--     not confirm that an address is a real account — but "a client credential was
--     used against the admin surface" is a materially different event from a wrong
--     password and is worth being able to see.
CREATE TYPE auth_login_outcome AS ENUM (
  'success',
  'invalid_credentials',
  'unknown_identity',
  'account_not_active',
  'password_changed',
  'not_authorized'
);

CREATE TABLE auth_login_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  -- Null for an attempt against an address with no account.
  --
  -- No foreign key, deliberately, and the same for `session_id`. This follows
  -- `audit_events`, which references `entity_id` without one: an append-only log
  -- must outlive the rows it describes. The alternative was incoherent —
  -- `ON DELETE SET NULL` plus the `auth_login_events_success_identified` CHECK
  -- below cancel each other out, because a referential action is an UPDATE and
  -- CHECKs are enforced on UPDATE, so the delete would abort with 23514 instead
  -- of detaching anything. Nothing deletes `users` (auth_sessions references it
  -- ON DELETE RESTRICT) or `auth_sessions` (revocation sets `state`) today, so
  -- the choice is about which way a future delete fails, and history that
  -- silently loses its subject is the worse of the two.
  user_id uuid,
  -- The address as submitted, normalised the same way `users.email_normalized`
  -- is, so failed attempts against a non-existent account are still groupable.
  email_normalized text NOT NULL,
  channel session_channel NOT NULL,
  outcome auth_login_outcome NOT NULL,
  -- Set only on success.
  session_id uuid,
  device_id_hash bytea,
  ip_address inet,
  user_agent text,
  request_id uuid NOT NULL,
  CONSTRAINT auth_login_events_email_present CHECK (btrim(email_normalized) <> ''),
  CONSTRAINT auth_login_events_email_normalized CHECK (email_normalized = lower(email_normalized)),
  CONSTRAINT auth_login_events_device_hash_len CHECK (device_id_hash IS NULL OR octet_length(device_id_hash) = 32),
  -- A success must name the account and the session it created; anything else
  -- is a row that cannot be interpreted later.
  CONSTRAINT auth_login_events_success_identified CHECK (
    outcome <> 'success' OR (user_id IS NOT NULL AND session_id IS NOT NULL)
  ),
  -- Only a success creates a session.
  CONSTRAINT auth_login_events_failure_has_no_session CHECK (
    outcome = 'success' OR session_id IS NULL
  ),
  -- Same bound and control-character rule `audit_events` and `auth_sessions`
  -- apply (migrations 011, 012).
  CONSTRAINT auth_login_events_user_agent_bounded CHECK (
    user_agent IS NULL
    OR (octet_length(user_agent) <= 512 AND user_agent !~ '[[:cntrl:]]')
  )
);

-- The per-user history read: newest first for one account.
CREATE INDEX auth_login_events_user_idx ON auth_login_events (user_id, occurred_at DESC, id DESC);

-- Failed attempts against an address, including ones with no account. Partial:
-- successes are already covered by the user index, and the failure lane is the
-- one that gets scanned for abuse.
CREATE INDEX auth_login_events_failure_email_idx
  ON auth_login_events (email_normalized, occurred_at DESC)
  WHERE outcome <> 'success';

-- Keyset pagination for an admin-wide view, matching the other admin lists.
CREATE INDEX auth_login_events_queue_idx ON auth_login_events (occurred_at DESC, id DESC);

COMMENT ON TABLE auth_login_events IS
  'Append-only per-user sign-in attempt log (success and failure). Written outside any transaction on the failure path; never stores secrets.';

-- Backfill what is recoverable: every historical successful native/web login
-- already has an audit row naming the session it created. IP and user agent
-- were never captured, so they stay null — an honest null rather than a
-- fabricated value.
INSERT INTO auth_login_events (
  occurred_at, user_id, email_normalized, channel, outcome, session_id, device_id_hash, request_id
)
SELECT
  a.occurred_at,
  a.actor_user_id,
  -- `lower()` because a tombstoned user's `email_normalized` is exempt from the
  -- live-PII CHECK in 010 and so is not guaranteed lowercase.
  lower(u.email_normalized),
  s.channel,
  'success',
  s.id,
  s.device_id_hash,
  a.request_id
FROM audit_events a
JOIN auth_sessions s ON s.id = a.entity_id
JOIN users u ON u.id = a.actor_user_id
WHERE a.command IN ('auth.native_login', 'auth.web_login')
  AND a.entity_type = 'auth_session';

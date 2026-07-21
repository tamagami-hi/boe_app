-- BE-007b: canonical identity/invite tables (additive; first-slice).
-- Depends on 009 (applications, verification_tokens). Applied on a fresh
-- canonical baseline (runner filtered to versions >= 009); the legacy 001 users
-- table is not part of this baseline and is archived at CLEAN-002.

DO $$ BEGIN
  CREATE TYPE user_account_state AS ENUM ('invited', 'active', 'suspended', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE activation_invite_state AS ENUM ('pending', 'accepted', 'revoked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE application_decision AS ENUM ('approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid REFERENCES applications (id) ON DELETE RESTRICT,
  email_normalized text NOT NULL,
  phone_e164 text NOT NULL,
  full_name text NOT NULL,
  account_state user_account_state NOT NULL DEFAULT 'invited',
  activated_at timestamptz,
  suspended_at timestamptz,
  closed_at timestamptz,
  pii_tombstoned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT users_version_positive CHECK (version > 0),
  CONSTRAINT users_email_uk UNIQUE (email_normalized),
  CONSTRAINT users_phone_uk UNIQUE (phone_e164),
  CONSTRAINT users_application_uk UNIQUE (application_id),
  CONSTRAINT users_id_application_uk UNIQUE (id, application_id),
  CONSTRAINT users_live_pii_valid CHECK (
    pii_tombstoned_at IS NOT NULL OR (
      email_normalized = lower(btrim(email_normalized))
      AND char_length(email_normalized) <= 254
      AND (char_length(email_normalized) - char_length(replace(email_normalized, '@', ''))) = 1
      AND phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
      AND char_length(btrim(full_name)) BETWEEN 2 AND 120
      AND full_name !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT users_activated_ts CHECK (account_state = 'invited' OR activated_at IS NOT NULL),
  CONSTRAINT users_suspended_ts CHECK (account_state <> 'suspended' OR suspended_at IS NOT NULL),
  CONSTRAINT users_closed_ts CHECK (account_state <> 'closed' OR closed_at IS NOT NULL)
);

CREATE INDEX users_state_created_idx ON users (account_state, created_at);

CREATE TABLE user_credentials (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE RESTRICT,
  password_hash text,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  failed_attempt_count integer NOT NULL DEFAULT 0,
  failed_attempt_window_started_at timestamptz,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT user_credentials_version_positive CHECK (version > 0),
  CONSTRAINT user_credentials_hash_prefix CHECK (password_hash IS NULL OR password_hash LIKE '$argon2id$%'),
  CONSTRAINT user_credentials_attempts_nonneg CHECK (failed_attempt_count >= 0),
  CONSTRAINT user_credentials_window CHECK (
    (failed_attempt_count > 0 AND failed_attempt_window_started_at IS NOT NULL)
    OR (failed_attempt_count = 0 AND failed_attempt_window_started_at IS NULL)
  )
);

CREATE TABLE application_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications (id) ON DELETE RESTRICT,
  reviewer_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  decision application_decision NOT NULL,
  reason_code text NOT NULL,
  reason_detail text,
  request_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT application_reviews_application_uk UNIQUE (application_id),
  CONSTRAINT application_reviews_reviewer_idem_uk UNIQUE (reviewer_user_id, idempotency_key),
  CONSTRAINT application_reviews_reason_check CHECK (btrim(reason_code) <> ''),
  CONSTRAINT application_reviews_detail_check CHECK (reason_detail IS NULL OR char_length(reason_detail) <= 2000)
);

CREATE INDEX application_reviews_reviewer_idx ON application_reviews (reviewer_user_id, created_at DESC);

CREATE TABLE activation_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  application_id uuid NOT NULL REFERENCES applications (id) ON DELETE RESTRICT,
  token_hash bytea NOT NULL,
  token_key_version text NOT NULL,
  state activation_invite_state NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  revocation_reason text,
  created_by_user_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT activation_invites_user_app_fk
    FOREIGN KEY (user_id, application_id) REFERENCES users (id, application_id) ON DELETE RESTRICT,
  CONSTRAINT activation_invites_version_positive CHECK (version > 0),
  CONSTRAINT activation_invites_hash_uk UNIQUE (token_hash),
  CONSTRAINT activation_invites_id_user_uk UNIQUE (id, user_id),
  CONSTRAINT activation_invites_hash_check CHECK (octet_length(token_hash) = 32),
  CONSTRAINT activation_invites_keyver_check CHECK (btrim(token_key_version) <> ''),
  CONSTRAINT activation_invites_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT activation_invites_accepted_check CHECK ((state = 'accepted') = (accepted_at IS NOT NULL)),
  CONSTRAINT activation_invites_revoked_check CHECK (
    (state = 'revoked' AND revoked_at IS NOT NULL AND revocation_reason IS NOT NULL)
    OR (state <> 'revoked' AND revoked_at IS NULL AND revocation_reason IS NULL)
  )
);

CREATE UNIQUE INDEX activation_invites_pending_user_uk ON activation_invites (user_id)
  WHERE state = 'pending';
CREATE INDEX activation_invites_expiry_idx ON activation_invites (expires_at)
  WHERE state = 'pending';

ALTER TABLE verification_tokens
  ADD CONSTRAINT verification_tokens_user_fk
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT;

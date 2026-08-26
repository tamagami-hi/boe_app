ALTER TABLE users
  ADD COLUMN email_verification_state text NOT NULL DEFAULT 'not_started',
  ADD COLUMN email_verification_started_at timestamptz NULL,
  ADD COLUMN email_verified_at timestamptz NULL,
  ADD COLUMN email_verification_expires_at timestamptz NULL;

ALTER TABLE users
  ADD CONSTRAINT users_email_verification_state_check
  CHECK (email_verification_state IN ('not_started', 'pending', 'verified', 'rejected'));

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
  CONSTRAINT email_verification_codes_expiry CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX email_verification_codes_active_user_uk
  ON email_verification_codes (user_id)
  WHERE consumed_at IS NULL;

CREATE INDEX email_verification_codes_user_idx
  ON email_verification_codes (user_id, created_at DESC);

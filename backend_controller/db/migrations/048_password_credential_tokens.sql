DO $$ BEGIN
  CREATE TYPE password_token_purpose AS ENUM ('set', 'reset');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE password_credential_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  purpose password_token_purpose NOT NULL,
  token_hash bytea NOT NULL,
  token_key_version text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT password_credential_tokens_hash_len CHECK (octet_length(token_hash) = 32),
  CONSTRAINT password_credential_tokens_key_version CHECK (btrim(token_key_version) <> ''),
  CONSTRAINT password_credential_tokens_attempts CHECK (attempt_count >= 0),
  CONSTRAINT password_credential_tokens_expiry CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX password_credential_tokens_active_user_uk
  ON password_credential_tokens (user_id)
  WHERE consumed_at IS NULL;

CREATE INDEX password_credential_tokens_user_idx
  ON password_credential_tokens (user_id, created_at DESC);

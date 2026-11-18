CREATE TABLE admin_step_up_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  session_id uuid NOT NULL,
  action text NOT NULL,
  token_hash bytea NOT NULL,
  token_key_version text NOT NULL,
  request_sha256 bytea NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  CONSTRAINT admin_step_up_confirmations_action CHECK (action IN ('app_config.publish')),
  CONSTRAINT admin_step_up_confirmations_hash_len CHECK (octet_length(token_hash) = 32),
  CONSTRAINT admin_step_up_confirmations_key_version CHECK (btrim(token_key_version) <> ''),
  CONSTRAINT admin_step_up_confirmations_request_len CHECK (octet_length(request_sha256) = 32),
  CONSTRAINT admin_step_up_confirmations_expiry CHECK (expires_at > created_at),
  CONSTRAINT admin_step_up_confirmations_consumed CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE UNIQUE INDEX admin_step_up_confirmations_token_hash_uk ON admin_step_up_confirmations (token_hash);

CREATE INDEX admin_step_up_confirmations_expiry_idx ON admin_step_up_confirmations (expires_at);

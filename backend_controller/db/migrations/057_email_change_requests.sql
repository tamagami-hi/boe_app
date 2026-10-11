CREATE TABLE email_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  target_ciphertext bytea NOT NULL,
  target_nonce bytea NOT NULL,
  target_key_version text NOT NULL,
  code_hash bytea NOT NULL,
  code_key_version text NOT NULL,
  bound_email_revision bigint NOT NULL,
  bound_credential_version bigint NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz NULL,
  CONSTRAINT email_change_requests_target_nonce CHECK (octet_length(target_nonce) = 12),
  CONSTRAINT email_change_requests_key_versions CHECK (
    btrim(target_key_version) <> '' AND btrim(code_key_version) <> ''
  ),
  CONSTRAINT email_change_requests_binding CHECK (
    bound_email_revision > 0 AND bound_credential_version >= 0
  ),
  CONSTRAINT email_change_requests_attempts CHECK (attempt_count >= 0)
);

CREATE UNIQUE INDEX email_change_requests_active_user_uk ON email_change_requests (user_id)
  WHERE consumed_at IS NULL;
CREATE INDEX email_change_requests_user_idx ON email_change_requests (user_id, created_at DESC);

ALTER TABLE email_deliveries
  DROP CONSTRAINT email_deliveries_template_check,
  ADD CONSTRAINT email_deliveries_template_check CHECK (
    template_key IN (
      'application_rejected',
      'account_approved',
      'password_set_link',
      'password_reset_link',
      'password_app_download',
      'contact_phone_changed',
      'email_change_code',
      'contact_email_changed'
    )
  );

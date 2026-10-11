ALTER TABLE users
  ADD COLUMN email_revision bigint NOT NULL DEFAULT 1,
  ADD CONSTRAINT users_email_revision_positive CHECK (email_revision > 0);

ALTER TABLE password_credential_tokens
  ADD COLUMN bound_email_revision bigint NULL,
  ADD COLUMN bound_credential_version bigint NULL,
  ADD CONSTRAINT password_credential_tokens_binding_pair CHECK (
    (bound_email_revision IS NULL) = (bound_credential_version IS NULL)
  ),
  ADD CONSTRAINT password_credential_tokens_binding_range CHECK (
    bound_email_revision IS NULL
    OR (bound_email_revision > 0 AND bound_credential_version >= 0)
  );

UPDATE password_credential_tokens t
SET bound_email_revision = u.email_revision,
    bound_credential_version = COALESCE(c.version, 0)
FROM users u
LEFT JOIN user_credentials c ON c.user_id = u.id
WHERE u.id = t.user_id
  AND t.consumed_at IS NULL
  AND t.expires_at > now()
  AND t.bound_email_revision IS NULL;

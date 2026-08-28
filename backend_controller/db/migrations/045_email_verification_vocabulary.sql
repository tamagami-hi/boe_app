UPDATE users
SET email_verification_state = 'not_started',
    email_verification_started_at = NULL,
    email_verified_at = NULL,
    updated_at = now(),
    version = version + 1
WHERE email_verification_state = 'rejected';

ALTER TABLE users
  DROP CONSTRAINT users_email_verification_state_check,
  ADD CONSTRAINT users_email_verification_state_check
    CHECK (email_verification_state IN ('not_started', 'pending', 'verified')),
  DROP COLUMN email_verification_expires_at;

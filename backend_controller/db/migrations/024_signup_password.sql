-- 024_signup_password.sql
--
-- Move password choice from activation to signup.
--
-- Before this migration the only way a credential could exist was `activateUser`:
-- the applicant signed up with name/email/phone, an admin approved, an activation
-- invite was emailed, and the applicant chose a password when redeeming it. That
-- made the emailed invite a hard dependency of ever reaching an account, so an
-- undelivered invite meant an approved person who could never sign in.
--
-- The applicant now chooses their password on the public signup form, so the
-- credential material exists before the admin ever looks at the application, and
-- approval alone is enough to produce an account that can sign in. Two schema
-- changes support that:
--
--   1. `applications.password_hash` holds the Argon2id encoded hash from signup
--      until the decision copies it into `user_credentials`. It is nullable
--      because applications submitted before this change have no password, and
--      those keep the activation-invite path.
--
--   2. `email_deliveries` learns an `account_approved` template. Approval with a
--      password on file sends "your account is open, sign in with the password
--      you chose" instead of an invite, and that mail references no token, so it
--      needs the same reference shape as `application_rejected`.
--
-- Only the hash is stored, never the password. The same `$argon2id$` prefix CHECK
-- that guards `user_credentials.password_hash` guards this column, so a bcrypt or
-- plaintext value cannot be written here by a future code path either.

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS password_hash text;

DO $$ BEGIN
  ALTER TABLE applications
    ADD CONSTRAINT applications_password_hash_prefix
    CHECK (password_hash IS NULL OR password_hash LIKE '$argon2id$%');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A tombstoned application must not retain credential material: the PII purge
-- clears the hash, and this keeps that true even if a future purge forgets it.
DO $$ BEGIN
  ALTER TABLE applications
    ADD CONSTRAINT applications_tombstoned_no_password
    CHECK (pii_tombstoned_at IS NULL OR password_hash IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Widen the delivery template matrix for the new approval mail. Both constraints
-- are replaced rather than added to: they are single CHECKs enumerating the
-- allowed set, so the new key has to appear inside them.
ALTER TABLE email_deliveries
  DROP CONSTRAINT IF EXISTS email_deliveries_template_check;
ALTER TABLE email_deliveries
  ADD CONSTRAINT email_deliveries_template_check CHECK (
    template_key IN ('verify_email', 'activation_invite', 'application_rejected', 'account_approved')
  );

ALTER TABLE email_deliveries
  DROP CONSTRAINT IF EXISTS email_deliveries_template_refs;
ALTER TABLE email_deliveries
  ADD CONSTRAINT email_deliveries_template_refs CHECK (
    (template_key = 'verify_email'
      AND verification_token_id IS NOT NULL AND activation_invite_id IS NULL)
    OR (template_key = 'activation_invite'
      AND activation_invite_id IS NOT NULL AND verification_token_id IS NULL)
    OR (template_key = 'application_rejected'
      AND verification_token_id IS NULL AND activation_invite_id IS NULL)
    -- Approval mail carries no redeemable reference: the credential already
    -- exists, so there is nothing for the recipient to redeem.
    OR (template_key = 'account_approved'
      AND verification_token_id IS NULL AND activation_invite_id IS NULL)
  );

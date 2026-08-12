-- 025_onboarding_rework.sql
--
-- Collapse onboarding to a single-step approval.
--
-- The flow used to be: signup -> pending_email_verification -> (verify email on
-- the public site) -> submitted -> (admin starts review) -> in_review ->
-- approved/rejected, and approval emailed an activation invite the applicant
-- redeemed to choose a password. Since 024 the password is chosen at signup, so
-- none of that scaffolding earns its keep anymore:
--
--   * signup now lands directly in `submitted` (the password hash is already on
--     the application row), and the admin decides in one step;
--   * pre-approval email verification moves into the app as part of the KYC
--     step (OTP), so `verify_email` mail, `verification_tokens`, and
--     `applications.email_verified_at` are gone;
--   * the activation invite is gone with them — approval alone creates an
--     ACTIVE user with the signup credential, so `activation_invites`,
--     `activation_invite` mail, and their enum are dropped.
--
-- Concretely:
--
--   1. Rows still sitting in the removed states are normalised to `submitted`
--      so the enum rewrite below has nothing unmappable to fail on. A missing
--      `submitted_at` is backfilled rather than left null, because the admin
--      queue orders by it.
--
--   2. `application_state` is rebuilt as (submitted, approved, rejected,
--      withdrawn). Postgres cannot drop enum values in place, so the type is
--      renamed aside and recreated; only `applications.state` uses it
--      (`audit_events.from_state/to_state` are plain text). The two partial
--      unique indexes on the identity columns are dropped first and recreated
--      after: their predicates compare the column against enum literals, which
--      cannot be re-validated across the old/new type boundary while the
--      column type is being swapped.
--
--   3. `email_deliveries` loses the two reference columns that pointed at the
--      dropped tables (their FK constraints go with the columns), the template
--      CHECK is re-enumerated for the two remaining templates, and the
--      template/refs matrix CHECK is dropped outright: with no reference
--      columns left there is nothing for it to relate, and both remaining
--      templates are reference-free by construction. Historical deliveries of
--      the removed templates are deleted first — keeping them would violate
--      the new CHECK.
--
--   4. `verification_tokens`, `activation_invites`, and their enums are
--      dropped. `token_purpose` also covered `password_reset`, which was never
--      implemented; if a reset flow arrives it should get its own table.

UPDATE applications
SET state = 'submitted',
    submitted_at = COALESCE(submitted_at, now())
WHERE state IN ('pending_email_verification', 'in_review');

DROP INDEX applications_active_email_uk;
DROP INDEX applications_active_phone_uk;

ALTER TABLE applications
  ALTER COLUMN state DROP DEFAULT;

ALTER TYPE application_state RENAME TO application_state_old;

CREATE TYPE application_state AS ENUM ('submitted', 'approved', 'rejected', 'withdrawn');

ALTER TABLE applications
  ALTER COLUMN state TYPE application_state
  USING state::text::application_state;

ALTER TABLE applications
  ALTER COLUMN state SET DEFAULT 'submitted';

DROP TYPE application_state_old;

CREATE UNIQUE INDEX applications_active_email_uk ON applications (email_normalized)
  WHERE state NOT IN ('rejected', 'withdrawn');
CREATE UNIQUE INDEX applications_active_phone_uk ON applications (phone_e164)
  WHERE state NOT IN ('rejected', 'withdrawn');

ALTER TABLE applications
  DROP COLUMN IF EXISTS email_verified_at;

DELETE FROM email_deliveries
WHERE template_key IN ('verify_email', 'activation_invite');

ALTER TABLE email_deliveries
  DROP CONSTRAINT IF EXISTS email_deliveries_template_refs;

ALTER TABLE email_deliveries
  DROP COLUMN IF EXISTS verification_token_id,
  DROP COLUMN IF EXISTS activation_invite_id;

ALTER TABLE email_deliveries
  DROP CONSTRAINT IF EXISTS email_deliveries_template_check;
ALTER TABLE email_deliveries
  ADD CONSTRAINT email_deliveries_template_check CHECK (
    template_key IN ('application_rejected', 'account_approved')
  );

DROP TABLE IF EXISTS verification_tokens;
DROP TABLE IF EXISTS activation_invites;
DROP TYPE IF EXISTS token_purpose;
DROP TYPE IF EXISTS activation_invite_state;

-- Seed is insert-only, so upgraded databases need explicit removal of the
-- permissions that belonged solely to the deleted review/invitation flows.
DELETE FROM role_permissions
WHERE permission_id IN (
  SELECT id FROM permissions
  WHERE code IN ('applications.review', 'invitations.manage', 'kyc.read', 'kyc.review')
);

DELETE FROM permissions
WHERE code IN ('applications.review', 'invitations.manage', 'kyc.read', 'kyc.review');

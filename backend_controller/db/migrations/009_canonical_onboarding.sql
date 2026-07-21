-- BE-007a: canonical public-onboarding schema (additive; first-slice).
-- New tables only; verified not to collide with the legacy 001-008 chain.
-- The users-dependent tables (users, credentials, invites, sessions, reviews)
-- and RBAC/audit/idempotency/outbox/email arrive in later BE-007 child packets;
-- verification_tokens.user_id is a plain nullable column here and gains its
-- users FK when that table lands.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE application_state AS ENUM (
    'pending_email_verification', 'submitted', 'in_review',
    'approved', 'rejected', 'withdrawn'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE token_purpose AS ENUM (
    'application_email_verification', 'password_reset'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_normalized text NOT NULL,
  phone_e164 text NOT NULL,
  full_name text NOT NULL,
  state application_state NOT NULL DEFAULT 'pending_email_verification',
  email_verified_at timestamptz,
  submitted_at timestamptz,
  review_started_at timestamptz,
  decided_at timestamptz,
  withdrawn_at timestamptz,
  pii_tombstoned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT applications_version_positive CHECK (version > 0),
  -- Live-row PII validity is enforced only while not tombstoned; the exact
  -- tombstone marker format and full Unicode code-point rules are enforced at
  -- the Zod boundary and hardened in a later pass.
  CONSTRAINT applications_live_pii_valid CHECK (
    pii_tombstoned_at IS NOT NULL OR (
      email_normalized = lower(btrim(email_normalized))
      AND char_length(email_normalized) <= 254
      AND (char_length(email_normalized) - char_length(replace(email_normalized, '@', ''))) = 1
      AND phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
      AND char_length(btrim(full_name)) BETWEEN 2 AND 120
      AND full_name !~ '[[:cntrl:]]'
    )
  )
);

CREATE UNIQUE INDEX applications_active_email_uk ON applications (email_normalized)
  WHERE state NOT IN ('rejected', 'withdrawn');
CREATE UNIQUE INDEX applications_active_phone_uk ON applications (phone_e164)
  WHERE state NOT IN ('rejected', 'withdrawn');
CREATE INDEX applications_queue_state_idx ON applications (state, created_at DESC, id DESC);
CREATE INDEX applications_queue_idx ON applications (created_at DESC, id DESC);

CREATE TABLE consent_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  version text NOT NULL,
  public_path text NOT NULL,
  content_markdown text NOT NULL,
  content_sha256 bytea NOT NULL,
  published_at timestamptz NOT NULL,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consent_documents_kind_check CHECK (kind IN ('terms', 'privacy')),
  CONSTRAINT consent_documents_version_check CHECK (version ~ '^[A-Za-z0-9._-]{1,40}$'),
  CONSTRAINT consent_documents_path_check CHECK (public_path ~ '^/'),
  CONSTRAINT consent_documents_markdown_check CHECK (btrim(content_markdown) <> ''),
  -- The stored digest must equal SHA-256 of the Markdown bytes (pgcrypto).
  CONSTRAINT consent_documents_sha_check CHECK (content_sha256 = digest(content_markdown, 'sha256')),
  CONSTRAINT consent_documents_retire_check CHECK (retired_at IS NULL OR retired_at >= published_at),
  CONSTRAINT consent_documents_kind_version_uk UNIQUE (kind, version),
  CONSTRAINT consent_documents_public_path_uk UNIQUE (public_path)
);

CREATE UNIQUE INDEX consent_documents_current_kind_uk ON consent_documents (kind)
  WHERE retired_at IS NULL;

CREATE TABLE application_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications (id) ON DELETE RESTRICT,
  consent_document_id uuid NOT NULL REFERENCES consent_documents (id) ON DELETE RESTRICT,
  accepted_at timestamptz NOT NULL,
  ip_hmac bytea NOT NULL,
  ip_hmac_key_version text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT application_consents_uk UNIQUE (application_id, consent_document_id),
  CONSTRAINT application_consents_ip_hmac_check CHECK (octet_length(ip_hmac) = 32),
  CONSTRAINT application_consents_keyver_check CHECK (btrim(ip_hmac_key_version) <> ''),
  CONSTRAINT application_consents_ua_check CHECK (
    user_agent IS NULL OR (octet_length(user_agent) <= 512 AND user_agent !~ '[[:cntrl:]]')
  )
);

CREATE INDEX application_consents_app_idx ON application_consents (application_id, accepted_at DESC);

CREATE TABLE verification_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid REFERENCES applications (id) ON DELETE RESTRICT,
  user_id uuid,
  purpose token_purpose NOT NULL,
  token_hash bytea NOT NULL,
  token_key_version text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT verification_tokens_subject_check CHECK (
    (application_id IS NOT NULL AND user_id IS NULL AND purpose = 'application_email_verification')
    OR (application_id IS NULL AND user_id IS NOT NULL AND purpose = 'password_reset')
  ),
  CONSTRAINT verification_tokens_hash_check CHECK (octet_length(token_hash) = 32),
  CONSTRAINT verification_tokens_keyver_check CHECK (btrim(token_key_version) <> ''),
  CONSTRAINT verification_tokens_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT verification_tokens_terminal_check CHECK (
    NOT (consumed_at IS NOT NULL AND revoked_at IS NOT NULL)
  ),
  CONSTRAINT verification_tokens_hash_uk UNIQUE (token_hash),
  CONSTRAINT verification_tokens_app_uk UNIQUE (id, application_id)
);

CREATE UNIQUE INDEX verification_tokens_pending_app_uk
  ON verification_tokens (application_id, purpose)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;
CREATE INDEX verification_tokens_expiry_idx ON verification_tokens (expires_at)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

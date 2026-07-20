-- BE-021 (later-domain slice): canonical compliance schema (spec 03 §4.1).
-- Additive on the canonical baseline (>= 009). KYC and risk power the derived
-- investing eligibility (§2.3); eligibility itself is never stored. Encrypted PII
-- uses AES-256-GCM envelopes and is erasable. Never cascade from users.

DO $$ BEGIN
  CREATE TYPE kyc_case_state AS ENUM (
    'pending_submission', 'submitted', 'in_review', 'approved', 'rejected', 'needs_information'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE risk_assessment_state AS ENUM ('not_started', 'submitted', 'assessed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE risk_category AS ENUM ('conservative', 'balanced', 'growth', 'aggressive');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE investor_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  date_of_birth_ciphertext bytea NULL,
  date_of_birth_nonce bytea NULL,
  address_ciphertext bytea NULL,
  address_nonce bytea NULL,
  encryption_key_version text NULL,
  erased_at timestamptz NULL,
  tax_residency_country char(2) NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT investor_profiles_country_iso
    CHECK (tax_residency_country IS NULL OR tax_residency_country ~ '^[A-Z]{2}$'),
  CONSTRAINT investor_profiles_dob_envelope CHECK (
    (date_of_birth_ciphertext IS NULL AND date_of_birth_nonce IS NULL)
    OR (
      octet_length(date_of_birth_ciphertext) >= 16
      AND octet_length(date_of_birth_nonce) = 12
      AND encryption_key_version IS NOT NULL
    )
  ),
  CONSTRAINT investor_profiles_address_envelope CHECK (
    (address_ciphertext IS NULL AND address_nonce IS NULL)
    OR (
      octet_length(address_ciphertext) >= 16
      AND octet_length(address_nonce) = 12
      AND encryption_key_version IS NOT NULL
    )
  ),
  CONSTRAINT investor_profiles_erasure CHECK (
    erased_at IS NULL
    OR (
      date_of_birth_ciphertext IS NULL AND date_of_birth_nonce IS NULL
      AND address_ciphertext IS NULL AND address_nonce IS NULL
      AND encryption_key_version IS NULL
    )
  )
);

CREATE TABLE kyc_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  state kyc_case_state NOT NULL DEFAULT 'pending_submission',
  provider text NULL,
  provider_case_id text NULL,
  submitted_at timestamptz NULL,
  review_started_at timestamptz NULL,
  decided_at timestamptz NULL,
  expires_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT kyc_cases_id_user_uk UNIQUE (id, user_id)
);

CREATE UNIQUE INDEX kyc_cases_provider_pair_uk
  ON kyc_cases (provider, provider_case_id)
  WHERE provider IS NOT NULL AND provider_case_id IS NOT NULL;

CREATE UNIQUE INDEX kyc_cases_one_open_per_user_uk
  ON kyc_cases (user_id)
  WHERE state IN ('pending_submission', 'submitted', 'in_review', 'needs_information');

CREATE INDEX kyc_cases_review_queue_idx
  ON kyc_cases (state, submitted_at, id)
  WHERE state IN ('submitted', 'in_review');

CREATE TABLE kyc_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kyc_case_id uuid NOT NULL,
  user_id uuid NOT NULL,
  document_type text NOT NULL CHECK (btrim(document_type) <> ''),
  object_key text NOT NULL CHECK (btrim(object_key) <> ''),
  content_sha256 bytea NOT NULL CHECK (octet_length(content_sha256) = 32),
  encryption_key_version text NOT NULL CHECK (btrim(encryption_key_version) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kyc_documents_case_fk
    FOREIGN KEY (kyc_case_id, user_id) REFERENCES kyc_cases (id, user_id) ON DELETE RESTRICT,
  CONSTRAINT kyc_documents_content_uk UNIQUE (kyc_case_id, document_type, content_sha256)
);

CREATE TABLE kyc_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kyc_case_id uuid NOT NULL,
  user_id uuid NOT NULL,
  reviewer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  from_state kyc_case_state NULL,
  to_state kyc_case_state NOT NULL,
  reason_code text NULL,
  reason_detail text NULL,
  request_id text NOT NULL CHECK (btrim(request_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kyc_reviews_case_fk
    FOREIGN KEY (kyc_case_id, user_id) REFERENCES kyc_cases (id, user_id) ON DELETE RESTRICT
);

CREATE INDEX kyc_reviews_case_chronology_idx ON kyc_reviews (kyc_case_id, created_at, id);

CREATE TABLE risk_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  state risk_assessment_state NOT NULL DEFAULT 'not_started',
  questionnaire_version text NOT NULL CHECK (btrim(questionnaire_version) <> ''),
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  score integer NULL,
  category risk_category NULL,
  submitted_at timestamptz NULL,
  assessed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT risk_assessments_id_user_uk UNIQUE (id, user_id),
  CONSTRAINT risk_assessments_answers_object CHECK (jsonb_typeof(answers) = 'object'),
  CONSTRAINT risk_assessments_score_range CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
  CONSTRAINT risk_assessments_assessed_complete CHECK (
    state <> 'assessed'
    OR (score IS NOT NULL AND category IS NOT NULL AND assessed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX risk_assessments_one_open_per_user_uk
  ON risk_assessments (user_id)
  WHERE state IN ('not_started', 'submitted');

CREATE INDEX risk_assessments_review_queue_idx
  ON risk_assessments (state, submitted_at, id)
  WHERE state = 'submitted';

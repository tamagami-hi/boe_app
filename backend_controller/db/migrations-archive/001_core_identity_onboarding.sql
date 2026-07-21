CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('client', 'admin', 'operations', 'support', 'system');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE user_status AS ENUM (
    'draft',
    'pending_review',
    'kyc_pending',
    'approved',
    'rejected',
    'suspended',
    'closed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE review_status AS ENUM (
    'not_started',
    'pending',
    'in_review',
    'approved',
    'rejected',
    'needs_more_information'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE risk_category AS ENUM ('conservative', 'balanced', 'growth', 'aggressive');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL,
  phone text,
  password_hash text,
  role user_role NOT NULL DEFAULT 'client',
  status user_status NOT NULL DEFAULT 'draft',
  risk_profile_status review_status NOT NULL DEFAULT 'not_started',
  kyc_status review_status NOT NULL DEFAULT 'not_started',
  approved_at timestamptz,
  rejected_at timestamptz,
  suspended_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_normalized_chk CHECK (email = lower(email)),
  CONSTRAINT users_status_timestamps_chk CHECK (
    (status <> 'approved' OR approved_at IS NOT NULL)
    AND (status <> 'rejected' OR rejected_at IS NOT NULL)
    AND (status <> 'suspended' OR suspended_at IS NOT NULL)
    AND (status <> 'closed' OR closed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_uidx ON users (email);
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_uidx ON users (phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_status_idx ON users (status);
CREATE INDEX IF NOT EXISTS users_role_idx ON users (role);
CREATE INDEX IF NOT EXISTS users_kyc_status_idx ON users (kyc_status);
CREATE INDEX IF NOT EXISTS users_risk_profile_status_idx ON users (risk_profile_status);
CREATE INDEX IF NOT EXISTS users_created_at_idx ON users (created_at DESC);

CREATE TABLE IF NOT EXISTS device_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  device_id text NOT NULL,
  refresh_token_hash text NOT NULL,
  user_agent text,
  ip_address inet,
  push_token text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT device_sessions_expiry_chk CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS device_sessions_refresh_token_hash_uidx
  ON device_sessions (refresh_token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS device_sessions_active_device_uidx
  ON device_sessions (user_id, device_id)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS device_sessions_user_id_idx ON device_sessions (user_id);
CREATE INDEX IF NOT EXISTS device_sessions_last_seen_at_idx ON device_sessions (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS device_sessions_expires_at_idx ON device_sessions (expires_at);

CREATE TABLE IF NOT EXISTS kyc_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  pan_number_encrypted text,
  pan_last4 text,
  aadhaar_last4 text,
  address_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  document_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  review_status review_status NOT NULL DEFAULT 'not_started',
  admin_notes text,
  reviewed_by uuid REFERENCES users (id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kyc_profiles_pan_last4_chk CHECK (pan_last4 IS NULL OR pan_last4 ~ '^[A-Za-z0-9]{4}$'),
  CONSTRAINT kyc_profiles_aadhaar_last4_chk CHECK (aadhaar_last4 IS NULL OR aadhaar_last4 ~ '^[0-9]{4}$'),
  CONSTRAINT kyc_profiles_reviewed_chk CHECK (
    (review_status NOT IN ('approved', 'rejected') AND reviewed_at IS NULL)
    OR (review_status IN ('approved', 'rejected') AND reviewed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS kyc_profiles_review_status_idx ON kyc_profiles (review_status);
CREATE INDEX IF NOT EXISTS kyc_profiles_reviewed_by_idx ON kyc_profiles (reviewed_by);

CREATE TABLE IF NOT EXISTS risk_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  age_band text NOT NULL,
  investment_horizon text NOT NULL,
  income_band text NOT NULL,
  loss_tolerance text NOT NULL,
  investment_experience text NOT NULL,
  risk_score integer NOT NULL,
  risk_category risk_category NOT NULL,
  answers_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT risk_profiles_score_chk CHECK (risk_score BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS risk_profiles_risk_category_idx ON risk_profiles (risk_category);
CREATE INDEX IF NOT EXISTS risk_profiles_completed_at_idx ON risk_profiles (completed_at DESC);

CREATE TABLE IF NOT EXISTS kyc_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  reviewer_id uuid REFERENCES users (id) ON DELETE SET NULL,
  from_status review_status,
  to_status review_status NOT NULL,
  reason text NOT NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kyc_review_events_user_id_created_at_idx
  ON kyc_review_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS kyc_review_events_reviewer_id_idx ON kyc_review_events (reviewer_id);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid REFERENCES users (id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  before_json jsonb,
  after_json jsonb,
  reason text,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_audit_logs_action_chk CHECK (length(trim(action)) > 0),
  CONSTRAINT admin_audit_logs_entity_type_chk CHECK (length(trim(entity_type)) > 0)
);

CREATE INDEX IF NOT EXISTS admin_audit_logs_admin_id_created_at_idx
  ON admin_audit_logs (admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_logs_entity_idx
  ON admin_audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_logs_action_created_at_idx
  ON admin_audit_logs (action, created_at DESC);

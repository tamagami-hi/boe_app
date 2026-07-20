-- BE-021 (later-domain slice): canonical platform/policy/content schema (spec 03
-- §4.5). Monetary approval thresholds live only in typed finance_policy_versions
-- (never JSON/app config). Marketing-lead PII is encrypted and erasable. Courses,
-- plans, app config, and content are versioned with one published/current row.

CREATE TABLE finance_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version integer NOT NULL CHECK (version > 0),
  redemption_dual_approval_threshold_paise bigint NOT NULL DEFAULT 10000000
    CHECK (redemption_dual_approval_threshold_paise > 0),
  effective_from timestamptz NOT NULL,
  retired_at timestamptz NULL,
  published_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_policy_versions_version_uk UNIQUE (version)
);

CREATE UNIQUE INDEX finance_policy_versions_one_active_uk
  ON finance_policy_versions ((true))
  WHERE retired_at IS NULL;

CREATE TABLE marketing_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name_ciphertext bytea NULL,
  full_name_nonce bytea NULL,
  email_ciphertext bytea NULL,
  email_nonce bytea NULL,
  phone_ciphertext bytea NULL,
  phone_nonce bytea NULL,
  email_hmac bytea NULL,
  phone_hmac bytea NULL,
  pii_key_version text NULL,
  pii_erased_at timestamptz NULL,
  source text NOT NULL CHECK (btrim(source) <> ''),
  state text NOT NULL DEFAULT 'new',
  application_id uuid NULL REFERENCES applications(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT marketing_leads_state CHECK (state IN ('new', 'contacted', 'converted', 'closed')),
  CONSTRAINT marketing_leads_active_envelope CHECK (
    pii_erased_at IS NOT NULL OR (
      full_name_ciphertext IS NOT NULL AND full_name_nonce IS NOT NULL AND octet_length(full_name_nonce) = 12
      AND email_ciphertext IS NOT NULL AND email_nonce IS NOT NULL AND octet_length(email_nonce) = 12
      AND email_hmac IS NOT NULL AND octet_length(email_hmac) = 32
      AND pii_key_version IS NOT NULL
    )
  ),
  CONSTRAINT marketing_leads_phone_envelope CHECK (
    (phone_ciphertext IS NULL AND phone_nonce IS NULL AND phone_hmac IS NULL)
    OR (
      phone_ciphertext IS NOT NULL AND phone_nonce IS NOT NULL AND octet_length(phone_nonce) = 12
      AND phone_hmac IS NOT NULL AND octet_length(phone_hmac) = 32
    )
  ),
  CONSTRAINT marketing_leads_erasure CHECK (
    pii_erased_at IS NULL OR (
      full_name_ciphertext IS NULL AND full_name_nonce IS NULL
      AND email_ciphertext IS NULL AND email_nonce IS NULL
      AND phone_ciphertext IS NULL AND phone_nonce IS NULL
      AND email_hmac IS NULL AND phone_hmac IS NULL
      AND pii_key_version IS NULL AND state = 'closed'
    )
  )
);

CREATE UNIQUE INDEX marketing_leads_active_email_uk
  ON marketing_leads (email_hmac)
  WHERE state IN ('new', 'contacted') AND email_hmac IS NOT NULL;

CREATE UNIQUE INDEX marketing_leads_application_uk
  ON marketing_leads (application_id)
  WHERE application_id IS NOT NULL;

CREATE INDEX marketing_leads_queue_idx ON marketing_leads (state, created_at DESC, id DESC);

CREATE TABLE courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  version integer NOT NULL CHECK (version > 0),
  title text NOT NULL CHECK (btrim(title) <> ''),
  summary text NOT NULL,
  price_paise bigint NOT NULL DEFAULT 0 CHECK (price_paise >= 0),
  currency char(3) NOT NULL DEFAULT 'INR',
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
  state text NOT NULL DEFAULT 'draft',
  published_by_user_id uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  published_at timestamptz NULL,
  archived_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT courses_state CHECK (state IN ('draft', 'published', 'archived')),
  CONSTRAINT courses_slug_version_uk UNIQUE (slug, version)
);

CREATE UNIQUE INDEX courses_one_published_per_slug_uk
  ON courses (slug)
  WHERE state = 'published';

CREATE TABLE membership_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL CHECK (code ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  version integer NOT NULL CHECK (version > 0),
  name text NOT NULL CHECK (btrim(name) <> ''),
  description text NOT NULL,
  price_paise bigint NOT NULL DEFAULT 0 CHECK (price_paise >= 0),
  currency char(3) NOT NULL DEFAULT 'INR',
  billing_period_months integer NOT NULL CHECK (billing_period_months > 0),
  state text NOT NULL DEFAULT 'draft',
  published_by_user_id uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  published_at timestamptz NULL,
  archived_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT membership_plans_state CHECK (state IN ('draft', 'published', 'archived')),
  CONSTRAINT membership_plans_code_version_uk UNIQUE (code, version)
);

CREATE UNIQUE INDEX membership_plans_one_published_per_code_uk
  ON membership_plans (code)
  WHERE state = 'published';

CREATE TABLE app_config_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version integer NOT NULL CHECK (version > 0),
  payload jsonb NOT NULL,
  content_sha256 bytea NOT NULL CHECK (octet_length(content_sha256) = 32),
  published_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  published_at timestamptz NOT NULL,
  retired_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_config_versions_version_uk UNIQUE (version),
  CONSTRAINT app_config_versions_payload_object CHECK (jsonb_typeof(payload) = 'object')
);

CREATE UNIQUE INDEX app_config_versions_one_current_uk
  ON app_config_versions ((true))
  WHERE retired_at IS NULL;

CREATE TABLE content_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_key text NOT NULL CHECK (btrim(content_key) <> ''),
  kind text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  title text NOT NULL CHECK (btrim(title) <> ''),
  body text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'draft',
  published_by_user_id uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  published_at timestamptz NULL,
  archived_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_items_kind CHECK (kind IN ('faq', 'static_page', 'legal_disclosure')),
  CONSTRAINT content_items_state CHECK (state IN ('draft', 'published', 'archived')),
  CONSTRAINT content_items_payload_object CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT content_items_key_version_uk UNIQUE (content_key, version)
);

CREATE UNIQUE INDEX content_items_one_published_uk
  ON content_items (content_key)
  WHERE state = 'published';

CREATE INDEX content_items_kind_idx ON content_items (kind, state, content_key);

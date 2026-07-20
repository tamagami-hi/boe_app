-- BE-021 (later-domain slice): canonical fund catalog schema (spec 03 §4.2).
-- Additive on the canonical baseline. Published fund versions, disclosures, NAVs,
-- positions, and AUM snapshots are append-only and retained indefinitely; catalog
-- history is never cascaded from funds. Composite FKs keep linked disclosure/NAV
-- rows on the same fund.

DO $$ BEGIN
  CREATE TYPE fund_state AS ENUM ('draft', 'review_pending', 'published', 'paused', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE fund_risk_level AS ENUM ('low', 'moderate', 'high', 'very_high');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE funds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  state fund_state NOT NULL DEFAULT 'draft',
  current_published_version_id uuid NULL,
  published_at timestamptz NULL,
  paused_at timestamptz NULL,
  archived_at timestamptz NULL,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT funds_slug_uk UNIQUE (slug),
  CONSTRAINT funds_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT funds_archived_ts CHECK (state <> 'archived' OR archived_at IS NOT NULL),
  CONSTRAINT funds_paused_ts CHECK (state <> 'paused' OR paused_at IS NOT NULL),
  CONSTRAINT funds_published_ts CHECK (state IN ('draft', 'review_pending') OR published_at IS NOT NULL)
);

CREATE TABLE fund_disclosure_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id uuid NOT NULL REFERENCES funds(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  title text NOT NULL CHECK (btrim(title) <> ''),
  body text NOT NULL,
  content_sha256 bytea NOT NULL CHECK (octet_length(content_sha256) = 32),
  effective_from timestamptz NOT NULL,
  published_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fund_disclosure_versions_fund_version_uk UNIQUE (fund_id, version),
  CONSTRAINT fund_disclosure_versions_id_fund_uk UNIQUE (id, fund_id)
);

CREATE TABLE fund_nav_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id uuid NOT NULL REFERENCES funds(id) ON DELETE RESTRICT,
  nav numeric(24, 8) NOT NULL CHECK (nav > 0),
  as_of_date date NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  source text NULL,
  published_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fund_nav_prices_revision_uk UNIQUE (fund_id, as_of_date, revision),
  CONSTRAINT fund_nav_prices_id_fund_uk UNIQUE (id, fund_id)
);

CREATE TABLE fund_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id uuid NOT NULL REFERENCES funds(id) ON DELETE RESTRICT,
  as_of_date date NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  asset_key text NOT NULL CHECK (btrim(asset_key) <> ''),
  asset_name text NOT NULL,
  asset_class text NULL,
  sector text NULL,
  allocation_percent numeric(24, 8) NOT NULL CHECK (allocation_percent >= 0 AND allocation_percent <= 100),
  source text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fund_positions_revision_asset_uk UNIQUE (fund_id, as_of_date, revision, asset_key)
);

CREATE TABLE fund_aum_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id uuid NOT NULL REFERENCES funds(id) ON DELETE RESTRICT,
  as_of_date date NOT NULL,
  aum_paise bigint NOT NULL CHECK (aum_paise >= 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  source text NULL,
  published_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fund_aum_snapshots_revision_uk UNIQUE (fund_id, as_of_date, revision)
);

CREATE TABLE fund_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id uuid NOT NULL REFERENCES funds(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  name text NOT NULL CHECK (btrim(name) <> ''),
  category text NOT NULL CHECK (btrim(category) <> ''),
  objective text NOT NULL,
  risk_level fund_risk_level NOT NULL,
  currency char(3) NOT NULL DEFAULT 'INR',
  minimum_sip_paise bigint NOT NULL CHECK (minimum_sip_paise >= 0),
  minimum_purchase_paise bigint NOT NULL CHECK (minimum_purchase_paise >= 0),
  minimum_duration_months integer NULL CHECK (minimum_duration_months IS NULL OR minimum_duration_months > 0),
  recommended_holding_months integer NULL CHECK (recommended_holding_months IS NULL OR recommended_holding_months > 0),
  disclosure_version_id uuid NOT NULL,
  initial_nav_price_id uuid NOT NULL,
  terms_sha256 bytea NOT NULL CHECK (octet_length(terms_sha256) = 32),
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fund_versions_fund_version_uk UNIQUE (fund_id, version),
  CONSTRAINT fund_versions_id_fund_uk UNIQUE (id, fund_id),
  CONSTRAINT fund_versions_disclosure_fk
    FOREIGN KEY (disclosure_version_id, fund_id)
    REFERENCES fund_disclosure_versions (id, fund_id) ON DELETE RESTRICT,
  CONSTRAINT fund_versions_nav_fk
    FOREIGN KEY (initial_nav_price_id, fund_id)
    REFERENCES fund_nav_prices (id, fund_id) ON DELETE RESTRICT
);

-- The current-published pointer references a version of the same fund; null
-- before first publication.
ALTER TABLE funds
  ADD CONSTRAINT funds_current_version_fk
  FOREIGN KEY (current_published_version_id, id)
  REFERENCES fund_versions (id, fund_id) ON DELETE RESTRICT;

-- Canonical fund catalog schema (target persistence model, spec §5.8/§5.9).
-- Greenfield baseline: published fund versions, disclosures, positions, stock
-- disclosures, and AUM snapshots are append-only and retained indefinitely;
-- catalog history is never cascaded from funds. Composite FKs keep linked
-- disclosure rows on the same fund. Money is integer paise in bigint.
--
-- There is no NAV, no units, and no monthly AUM roll-forward: fund AUM is a
-- sequence of absolute, admin-published snapshots with per-date revisions
-- (spec §5.8). An AUM growth command calculates a new absolute snapshot from
-- the previous one; nothing stores investment/redemption flow components.

DO $$ BEGIN
  CREATE TYPE fund_state AS ENUM ('draft', 'review_pending', 'published', 'paused', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE fund_risk_level AS ENUM ('low', 'moderate', 'high', 'very_high');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Shared by both growth batch headers (spec §5.9): client_growth_batches in
-- 017 and aum_growth_batches below. Structurally separate tables, one shape.
DO $$ BEGIN
  CREATE TYPE growth_scope AS ENUM ('individual', 'collective');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE growth_instruction_type AS ENUM ('amount', 'percentage', 'explicit_deltas');
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

-- AUM growth batch header (spec §5.9): one audited admin command that produced
-- zero or more absolute AUM snapshots. Never shares an id space or a row with
-- client_growth_batches. `idempotency_record_id` ties the batch to the
-- canonical idempotency subsystem result committed in the same transaction.
CREATE TABLE aum_growth_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope growth_scope NOT NULL,
  instruction_type growth_instruction_type NOT NULL,
  effective_date date NOT NULL,
  reason_code text NOT NULL CHECK (btrim(reason_code) <> ''),
  note text NULL,
  basis_hash text NOT NULL CHECK (btrim(basis_hash) <> ''),
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_id text NOT NULL,
  idempotency_record_id uuid NULL REFERENCES idempotency_records(id) ON DELETE RESTRICT,
  target_count integer NOT NULL CHECK (target_count >= 0),
  total_delta_paise bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aum_growth_batches_idempotency_uk UNIQUE (idempotency_record_id)
);

CREATE INDEX aum_growth_batches_request_idx ON aum_growth_batches (request_id);

-- fund_aum_snapshots (spec §5.8): absolute admin-published AUM. Append-only
-- corrections: unique (fund_id, as_of_date, revision); the highest revision for
-- one fund/date is authoritative and a correction never mutates the prior row.
CREATE TABLE fund_aum_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id uuid NOT NULL REFERENCES funds(id) ON DELETE RESTRICT,
  as_of_date date NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  aum_paise bigint NOT NULL CHECK (aum_paise >= 0),
  aum_growth_batch_id uuid NULL REFERENCES aum_growth_batches(id) ON DELETE RESTRICT,
  reason_code text NOT NULL CHECK (btrim(reason_code) <> ''),
  note text NULL,
  published_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  -- Indexed, not unique: one collective HTTP request produces several snapshots.
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fund_aum_snapshots_revision_uk UNIQUE (fund_id, as_of_date, revision)
);

-- One batch output per fund per batch.
CREATE UNIQUE INDEX fund_aum_snapshots_batch_fund_uk
  ON fund_aum_snapshots (aum_growth_batch_id, fund_id)
  WHERE aum_growth_batch_id IS NOT NULL;

CREATE INDEX fund_aum_snapshots_request_idx ON fund_aum_snapshots (request_id);

-- Latest-AUM ordering: as_of_date DESC, revision DESC, created_at DESC, id DESC.
CREATE INDEX fund_aum_snapshots_latest_idx
  ON fund_aum_snapshots (fund_id, as_of_date DESC, revision DESC, created_at DESC, id DESC);

-- Administrator-curated stock list shown to investors, tagged by reporting
-- quarter. Entirely manual; no market data feed.
CREATE TABLE fund_stock_disclosures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id uuid NOT NULL REFERENCES funds(id) ON DELETE RESTRICT,
  stock_name text NOT NULL CHECK (btrim(stock_name) <> ''),
  -- Reporting quarter label, e.g. 'Q1 FY27'.
  quarter_label text NOT NULL CHECK (quarter_label ~ '^Q[1-4] FY[0-9]{2}$'),
  -- Optional published weight, percent of the pool.
  weight_percent numeric(9, 4) NULL CHECK (
    weight_percent IS NULL OR (weight_percent >= 0 AND weight_percent <= 100)
  ),
  state text NOT NULL DEFAULT 'active',
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  added_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  exited_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fund_stock_disclosures_state CHECK (state IN ('active', 'exited')),
  CONSTRAINT fund_stock_disclosures_exit_ts CHECK (state <> 'exited' OR exited_at IS NOT NULL),
  CONSTRAINT fund_stock_disclosures_unique_active UNIQUE (fund_id, stock_name, quarter_label)
);

CREATE INDEX fund_stock_disclosures_fund_idx
  ON fund_stock_disclosures (fund_id, state, sort_order, stock_name);

-- fund_versions: immutable issued terms. There is no price column: the model
-- has no NAV, so publication requires only the terms and their disclosure.
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
  terms_sha256 bytea NOT NULL CHECK (octet_length(terms_sha256) = 32),
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fund_versions_fund_version_uk UNIQUE (fund_id, version),
  CONSTRAINT fund_versions_id_fund_uk UNIQUE (id, fund_id),
  CONSTRAINT fund_versions_disclosure_fk
    FOREIGN KEY (disclosure_version_id, fund_id)
    REFERENCES fund_disclosure_versions (id, fund_id) ON DELETE RESTRICT
);

-- The current-published pointer references a version of the same fund; null
-- before first publication.
ALTER TABLE funds
  ADD CONSTRAINT funds_current_version_fk
  FOREIGN KEY (current_published_version_id, id)
  REFERENCES fund_versions (id, fund_id) ON DELETE RESTRICT;

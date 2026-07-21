DO $$ BEGIN
  CREATE TYPE product_status AS ENUM (
    'draft',
    'review_pending',
    'published',
    'coming_soon',
    'paused_for_investment',
    'archived'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE product_risk_level AS ENUM ('low', 'moderate', 'high', 'very_high');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  category text NOT NULL,
  status product_status NOT NULL DEFAULT 'draft',
  risk_level product_risk_level NOT NULL,
  objective text NOT NULL,
  minimum_sip_amount numeric(18, 2) NOT NULL,
  minimum_lumpsum_amount numeric(18, 2) NOT NULL,
  minimum_duration_months integer,
  recommended_holding_period_months integer,
  lock_in_text text,
  fee_text text,
  current_disclosure_id uuid,
  published_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_slug_format_chk CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT products_minimum_sip_amount_chk CHECK (minimum_sip_amount >= 0),
  CONSTRAINT products_minimum_lumpsum_amount_chk CHECK (minimum_lumpsum_amount >= 0),
  CONSTRAINT products_minimum_duration_chk CHECK (minimum_duration_months IS NULL OR minimum_duration_months > 0),
  CONSTRAINT products_recommended_holding_period_chk CHECK (
    recommended_holding_period_months IS NULL OR recommended_holding_period_months > 0
  ),
  CONSTRAINT products_publish_timestamp_chk CHECK (status <> 'published' OR published_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS products_slug_uidx ON products (slug);
CREATE INDEX IF NOT EXISTS products_status_idx ON products (status);
CREATE INDEX IF NOT EXISTS products_category_idx ON products (category);
CREATE INDEX IF NOT EXISTS products_risk_level_idx ON products (risk_level);

CREATE TABLE IF NOT EXISTS product_disclosures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  version integer NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  effective_from timestamptz NOT NULL,
  published_by uuid REFERENCES users (id) ON DELETE SET NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_disclosures_version_chk CHECK (version > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS product_disclosures_product_version_uidx
  ON product_disclosures (product_id, version);
CREATE INDEX IF NOT EXISTS product_disclosures_product_effective_idx
  ON product_disclosures (product_id, effective_from DESC);
CREATE INDEX IF NOT EXISTS product_disclosures_published_by_idx
  ON product_disclosures (published_by);

DO $$ BEGIN
  ALTER TABLE products
    ADD CONSTRAINT products_current_disclosure_fk
    FOREIGN KEY (current_disclosure_id) REFERENCES product_disclosures (id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- NAV tracking removed per business requirement
-- CREATE TABLE IF NOT EXISTS product_navs (...);

CREATE TABLE IF NOT EXISTS product_holdings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  symbol text,
  company_name text,
  sector text,
  asset_class text NOT NULL,
  allocation_percent numeric(7, 4) NOT NULL,
  as_of_date date NOT NULL,
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_holdings_allocation_chk CHECK (allocation_percent >= 0 AND allocation_percent <= 100),
  CONSTRAINT product_holdings_label_chk CHECK (company_name IS NOT NULL OR asset_class IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS product_holdings_product_asof_asset_uidx
  ON product_holdings (product_id, as_of_date, asset_class, COALESCE(symbol, ''), COALESCE(company_name, ''));
CREATE INDEX IF NOT EXISTS product_holdings_product_asof_idx
  ON product_holdings (product_id, as_of_date DESC);
CREATE INDEX IF NOT EXISTS product_holdings_asset_class_idx ON product_holdings (asset_class);
CREATE INDEX IF NOT EXISTS product_holdings_sector_idx ON product_holdings (sector);

-- Performance tracking removed per business requirement
-- CREATE TABLE IF NOT EXISTS product_performance_points (...);

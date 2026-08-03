-- OB-001: Option B investment model — money-denominated ledger, no units, no NAV.
--
-- The previous model priced ownership in units against an admin-declared NAV
-- (`fund_nav_prices`, `holdings`, `holding_lots`, `holding_lot_movements`,
-- `investment_executions`). Option B removes per-unit pricing entirely:
--
--   Total Investment       = SIP paid + lump sums - principal redeemed
--   Current Value          = previous value + allocated gain - redemption + new investment
--   Total Return           = Current Value - Total Investment
--   Return %               = Total Return / Total Investment x 100
--   Fund AUM (monthly)     = previous AUM + new investments - redemptions +/- portfolio gain
--
-- Growth is *allocated per investor by an administrator*, not derived from a
-- price. Every event — installment, lump sum, redemption, gain allocation, AUM
-- update, stock-list change — is its own dated, append-only record, and every
-- dashboard figure is derived from those records rather than from a stored
-- balance. That keeps audit, tax reporting, and dispute resolution possible.
--
-- The unit-era tables are left in place but are no longer written or read by the
-- application: they hold historical evidence and are dropped in the clean
-- baseline once backfill/cutover proofs exist (CLEAN-002).

-- ── Per-investor transaction ledger ──────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE ledger_entry_type AS ENUM (
    'sip_installment',
    'lump_sum',
    'redemption',
    'gain_allocation',
    'adjustment'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE investor_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  fund_id uuid NOT NULL REFERENCES funds(id) ON DELETE RESTRICT,
  entry_type ledger_entry_type NOT NULL,

  -- `principal_delta_paise` moves Total Investment; `value_delta_paise` moves
  -- Current Portfolio Value. A contribution moves both by the same amount, a
  -- gain allocation moves only value, and a redemption reduces value by the cash
  -- paid out and principal only by its principal component.
  principal_delta_paise bigint NOT NULL,
  value_delta_paise bigint NOT NULL,

  -- The investor-facing amount of the event, always positive.
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  effective_date date NOT NULL,

  -- Provenance. Contributions come from an order/payment; gain allocations and
  -- adjustments come from an administrator and must say who and why.
  order_id uuid NULL,
  payment_id uuid NULL,
  redemption_request_id uuid NULL,
  allocated_by_user_id uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason_code text NULL,
  note text NULL,
  request_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT investor_ledger_entries_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT investor_ledger_entries_user_fk
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  -- Contributions add principal and value in equal measure.
  CONSTRAINT investor_ledger_entries_contribution_shape CHECK (
    entry_type NOT IN ('sip_installment', 'lump_sum')
    OR (principal_delta_paise = amount_paise AND value_delta_paise = amount_paise)
  ),
  -- An allocated gain (or loss) never changes what the investor put in.
  CONSTRAINT investor_ledger_entries_gain_shape CHECK (
    entry_type <> 'gain_allocation'
    OR (principal_delta_paise = 0 AND value_delta_paise <> 0 AND abs(value_delta_paise) = amount_paise)
  ),
  -- A redemption pays out cash: value falls by the full amount, principal falls
  -- by at most that amount (returns-only redemptions leave principal untouched).
  CONSTRAINT investor_ledger_entries_redemption_shape CHECK (
    entry_type <> 'redemption'
    OR (
      value_delta_paise = -amount_paise
      AND principal_delta_paise <= 0
      AND principal_delta_paise >= -amount_paise
    )
  ),
  -- Only an administrator-originated entry carries an allocator.
  CONSTRAINT investor_ledger_entries_allocator CHECK (
    entry_type IN ('gain_allocation', 'adjustment') = (allocated_by_user_id IS NOT NULL)
  )
);

-- Derivation reads the whole ledger for one (user, fund) or one user.
CREATE INDEX investor_ledger_entries_user_idx
  ON investor_ledger_entries (user_id, effective_date, created_at, id);
CREATE INDEX investor_ledger_entries_user_fund_idx
  ON investor_ledger_entries (user_id, fund_id, effective_date, created_at, id);
CREATE INDEX investor_ledger_entries_fund_idx
  ON investor_ledger_entries (fund_id, effective_date);
-- One ledger entry per booked payment: the settlement pass is idempotent.
CREATE UNIQUE INDEX investor_ledger_entries_payment_uk
  ON investor_ledger_entries (payment_id)
  WHERE payment_id IS NOT NULL;
CREATE UNIQUE INDEX investor_ledger_entries_redemption_uk
  ON investor_ledger_entries (redemption_request_id)
  WHERE redemption_request_id IS NOT NULL;

-- ── Monthly fund AUM ledger ──────────────────────────────────────────────────
-- Option B module 5: each month's closing AUM is derived from the previous
-- month's closing plus the period's flows, and only the closing figure is shown
-- to investors (with its "last updated" date).

CREATE TABLE fund_aum_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id uuid NOT NULL REFERENCES funds(id) ON DELETE RESTRICT,
  -- First day of the month the update closes (a period, not a timestamp).
  period_start date NOT NULL,
  opening_aum_paise bigint NOT NULL CHECK (opening_aum_paise >= 0),
  new_investments_paise bigint NOT NULL DEFAULT 0 CHECK (new_investments_paise >= 0),
  redemptions_paise bigint NOT NULL DEFAULT 0 CHECK (redemptions_paise >= 0),
  -- Signed: a loss is negative.
  portfolio_gain_paise bigint NOT NULL DEFAULT 0,
  closing_aum_paise bigint NOT NULL CHECK (closing_aum_paise >= 0),
  note text NULL,
  published_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fund_aum_updates_period_uk UNIQUE (fund_id, period_start),
  CONSTRAINT fund_aum_updates_period_is_month_start CHECK (date_trunc('month', period_start) = period_start),
  -- The identity must hold exactly; the closing figure is never free-typed.
  CONSTRAINT fund_aum_updates_identity CHECK (
    closing_aum_paise
      = opening_aum_paise + new_investments_paise - redemptions_paise + portfolio_gain_paise
  )
);

CREATE INDEX fund_aum_updates_latest_idx ON fund_aum_updates (fund_id, period_start DESC);

-- ── Administrator-controlled stock list ──────────────────────────────────────
-- Option B module 6: the investor sees which companies the fund holds and the
-- reporting quarter each entered. Entirely manual; no market data feed.

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

-- ── Redemptions become money-denominated ─────────────────────────────────────
-- Option B module: the investor redeems an amount (full / returns only / 50% /
-- custom), not a number of units.

DO $$ BEGIN
  CREATE TYPE redemption_mode AS ENUM ('full', 'returns_only', 'half', 'custom');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE redemption_requests
  ADD COLUMN mode redemption_mode NULL,
  ADD COLUMN requested_amount_paise bigint NULL CHECK (
    requested_amount_paise IS NULL OR requested_amount_paise > 0
  ),
  ADD COLUMN principal_component_paise bigint NULL CHECK (
    principal_component_paise IS NULL OR principal_component_paise >= 0
  ),
  ADD COLUMN returns_component_paise bigint NULL CHECK (
    returns_component_paise IS NULL OR returns_component_paise >= 0
  ),
  ADD COLUMN settled_amount_paise bigint NULL CHECK (
    settled_amount_paise IS NULL OR settled_amount_paise >= 0
  );

-- Unit-era columns become optional so the money path can insert without them.
ALTER TABLE redemption_requests
  ALTER COLUMN requested_units DROP NOT NULL,
  ALTER COLUMN estimated_value_paise DROP NOT NULL;

ALTER TABLE redemption_requests
  ADD CONSTRAINT redemption_requests_money_shape CHECK (
    -- Either the legacy unit shape or the Option B money shape, never neither.
    requested_units IS NOT NULL
    OR (mode IS NOT NULL AND requested_amount_paise IS NOT NULL)
  ),
  ADD CONSTRAINT redemption_requests_components CHECK (
    requested_amount_paise IS NULL
    OR coalesce(principal_component_paise, 0) + coalesce(returns_component_paise, 0)
       = requested_amount_paise
  );

-- Orders may now be recorded without a unit quantity: a redemption order in the
-- money model carries its amount in `amount_paise` like any other order.
ALTER TABLE investment_orders
  DROP CONSTRAINT IF EXISTS investment_orders_redemption_units,
  DROP CONSTRAINT IF EXISTS investment_orders_units_only_redemption;

ALTER TABLE investment_orders
  ADD CONSTRAINT investment_orders_amount_or_units CHECK (
    amount_paise IS NOT NULL OR requested_units IS NOT NULL
  );

-- ── Fund versions no longer require a price ──────────────────────────────────
-- `initial_nav_price_id` existed because a version could not be published without
-- a per-unit price to transact at. Option B has no price, so publication needs
-- only the version's terms and its disclosure. The column stays (nullable) so
-- historical rows keep pointing at the NAV they were published against.

ALTER TABLE fund_versions
  ALTER COLUMN initial_nav_price_id DROP NOT NULL;

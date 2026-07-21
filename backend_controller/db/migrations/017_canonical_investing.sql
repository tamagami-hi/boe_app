-- BE-021 (later-domain slice, increment 2): canonical investing/ownership schema
-- (spec 03 §4.3, plus the §4.4 `mandates` table which §4.3 `sip_plans` depends
-- on). Additive on the canonical baseline (>= 009). Money is integer paise in
-- bigint; NAV/units/allocation are numeric(24,8). Orders, executions, holdings,
-- lots, and lot movements are booked financial evidence: append-only by domain
-- rule and never cascaded. Ownership is carried as composite (…, user_id[/…,
-- fund_id]) foreign keys so a row can never reference another user's data.

DO $$ BEGIN
  CREATE TYPE mandate_state AS ENUM (
    'created', 'pending_user_authorization', 'active', 'paused', 'revoked', 'failed', 'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE sip_state AS ENUM (
    'draft', 'pending_mandate', 'active', 'paused', 'cancelled', 'completed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE order_type AS ENUM (
    'purchase', 'sip_installment', 'redemption', 'refund', 'adjustment'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE order_state AS ENUM (
    'submitted', 'payment_pending', 'payment_confirmed', 'booked',
    'payment_failed', 'cancelled', 'rejected', 'refunded', 'reversed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE execution_type AS ENUM (
    'allotment', 'redemption', 'refund', 'reversal', 'adjustment'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE redemption_state AS ENUM (
    'submitted', 'units_reserved', 'approved', 'settlement_pending', 'settled', 'rejected', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- mandates: the SIP ownership anchor. One mandate may authorize several SIPs for
-- the same user, so mandates do not own a single SIP FK. `(id, user_id)` is the
-- composite anchor referenced by `sip_plans`.
CREATE TABLE mandates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (btrim(provider) <> ''),
  provider_mandate_id text NULL,
  max_amount_paise bigint NOT NULL CHECK (max_amount_paise > 0),
  frequency text NOT NULL,
  debit_day integer NULL CHECK (debit_day IS NULL OR (debit_day >= 1 AND debit_day <= 28)),
  state mandate_state NOT NULL DEFAULT 'created',
  valid_from timestamptz NULL,
  valid_to timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT mandates_id_user_uk UNIQUE (id, user_id),
  -- Supported debit cadences. Spec §4.4 requires a closed supported set but does
  -- not enumerate it; this is the implementation's canonical list.
  CONSTRAINT mandates_frequency CHECK (
    frequency IN ('weekly', 'monthly', 'quarterly', 'semi_annual', 'annual', 'as_presented')
  ),
  CONSTRAINT mandates_validity_window CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from)
);

CREATE UNIQUE INDEX mandates_provider_pair_uk
  ON mandates (provider, provider_mandate_id)
  WHERE provider_mandate_id IS NOT NULL;

CREATE INDEX mandates_user_state_idx ON mandates (user_id, state, created_at DESC);

-- sip_plans: a user's recurring purchase schedule for a fund. Links a mandate
-- via composite (mandate_id, user_id) when one is attached (MATCH SIMPLE: the FK
-- is enforced only once mandate_id is set).
CREATE TABLE sip_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  fund_id uuid NOT NULL REFERENCES funds(id) ON DELETE RESTRICT,
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  debit_day integer NOT NULL CHECK (debit_day >= 1 AND debit_day <= 28),
  duration_months integer NULL CHECK (duration_months IS NULL OR duration_months > 0),
  state sip_state NOT NULL DEFAULT 'draft',
  mandate_id uuid NULL,
  start_date date NULL,
  next_due_date date NULL,
  paused_at timestamptz NULL,
  cancelled_at timestamptz NULL,
  completed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT sip_plans_id_user_uk UNIQUE (id, user_id),
  CONSTRAINT sip_plans_mandate_fk
    FOREIGN KEY (mandate_id, user_id) REFERENCES mandates (id, user_id) ON DELETE RESTRICT,
  CONSTRAINT sip_plans_paused_ts CHECK (state <> 'paused' OR paused_at IS NOT NULL),
  CONSTRAINT sip_plans_cancelled_ts CHECK (state <> 'cancelled' OR cancelled_at IS NOT NULL),
  CONSTRAINT sip_plans_completed_ts CHECK (state <> 'completed' OR completed_at IS NOT NULL)
);

CREATE INDEX sip_plans_user_history_idx ON sip_plans (user_id, created_at DESC, id DESC);
CREATE INDEX sip_plans_ops_queue_idx ON sip_plans (state, updated_at, id);

-- investment_orders: a single client intent (purchase / SIP installment /
-- redemption / refund / adjustment). `(id, user_id)` anchors downstream
-- ownership FKs on payments, executions, and redemption requests.
CREATE TABLE investment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  fund_id uuid NOT NULL REFERENCES funds(id) ON DELETE RESTRICT,
  sip_plan_id uuid NULL,
  type order_type NOT NULL,
  state order_state NOT NULL DEFAULT 'submitted',
  amount_paise bigint NULL,
  requested_units numeric(24, 8) NULL,
  currency char(3) NOT NULL DEFAULT 'INR',
  requested_at timestamptz NULL,
  payment_confirmed_at timestamptz NULL,
  booked_at timestamptz NULL,
  cancelled_at timestamptz NULL,
  failure_code text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT investment_orders_id_user_uk UNIQUE (id, user_id),
  CONSTRAINT investment_orders_sip_fk
    FOREIGN KEY (sip_plan_id, user_id) REFERENCES sip_plans (id, user_id) ON DELETE RESTRICT,
  -- Purchase / SIP-installment orders require positive money.
  CONSTRAINT investment_orders_purchase_amount
    CHECK (type NOT IN ('purchase', 'sip_installment') OR (amount_paise IS NOT NULL AND amount_paise > 0)),
  -- Redemptions require positive requested units.
  CONSTRAINT investment_orders_redemption_units
    CHECK (type <> 'redemption' OR (requested_units IS NOT NULL AND requested_units > 0)),
  -- Only redemptions may carry requested units.
  CONSTRAINT investment_orders_units_only_redemption
    CHECK (type = 'redemption' OR requested_units IS NULL),
  CONSTRAINT investment_orders_amount_nonneg
    CHECK (amount_paise IS NULL OR amount_paise > 0)
);

CREATE INDEX investment_orders_user_history_idx ON investment_orders (user_id, created_at DESC, id DESC);
CREATE INDEX investment_orders_ops_queue_idx ON investment_orders (state, updated_at, id);

-- investment_executions: append-only booked financial evidence for an order.
-- Ownership is carried by composite FK (order_id, user_id); the reversal self-FK
-- ties a reversal to the original execution of the same order/user/fund.
CREATE TABLE investment_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  fund_id uuid NOT NULL REFERENCES funds(id) ON DELETE RESTRICT,
  type execution_type NOT NULL,
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  nav numeric(24, 8) NULL,
  units numeric(24, 8) NULL,
  executed_at timestamptz NOT NULL DEFAULT now(),
  reverses_execution_id uuid NULL,
  provider_reference text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT investment_executions_id_user_fund_uk UNIQUE (id, user_id, fund_id),
  CONSTRAINT investment_executions_id_order_user_fund_uk UNIQUE (id, order_id, user_id, fund_id),
  CONSTRAINT investment_executions_order_fk
    FOREIGN KEY (order_id, user_id) REFERENCES investment_orders (id, user_id) ON DELETE RESTRICT,
  -- Only a reversal has a non-null reverses_execution_id, and a reversal must
  -- name the execution it reverses.
  CONSTRAINT investment_executions_reversal_link
    CHECK ((type = 'reversal') = (reverses_execution_id IS NOT NULL)),
  -- Refunds record money evidence only (no NAV/units) with a provider reference;
  -- all other types require positive NAV and units.
  CONSTRAINT investment_executions_refund_evidence CHECK (
    type <> 'refund'
    OR (nav IS NULL AND units IS NULL AND provider_reference IS NOT NULL AND btrim(provider_reference) <> '')
  ),
  CONSTRAINT investment_executions_priced_evidence CHECK (
    type = 'refund' OR (nav IS NOT NULL AND nav > 0 AND units IS NOT NULL AND units > 0)
  )
);

-- A reversal reverses exactly one original, and each original is reversed at most
-- once. The composite self-FK keeps the reversed execution on the same
-- order/user/fund.
ALTER TABLE investment_executions
  ADD CONSTRAINT investment_executions_reverses_fk
  FOREIGN KEY (reverses_execution_id, order_id, user_id, fund_id)
  REFERENCES investment_executions (id, order_id, user_id, fund_id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX investment_executions_reverses_uk
  ON investment_executions (reverses_execution_id)
  WHERE reverses_execution_id IS NOT NULL;

-- At most one non-reversal booking per order.
CREATE UNIQUE INDEX investment_executions_one_booking_per_order_uk
  ON investment_executions (order_id)
  WHERE type <> 'reversal';

CREATE UNIQUE INDEX investment_executions_provider_reference_uk
  ON investment_executions (provider_reference)
  WHERE provider_reference IS NOT NULL;

CREATE INDEX investment_executions_order_idx ON investment_executions (order_id, executed_at, id);

-- holdings: authoritative per-user, per-fund ownership balance.
CREATE TABLE holdings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  fund_id uuid NOT NULL REFERENCES funds(id) ON DELETE RESTRICT,
  total_units numeric(24, 8) NOT NULL DEFAULT 0 CHECK (total_units >= 0),
  reserved_units numeric(24, 8) NOT NULL DEFAULT 0 CHECK (reserved_units >= 0),
  cost_basis_paise bigint NOT NULL DEFAULT 0 CHECK (cost_basis_paise >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT holdings_user_fund_uk UNIQUE (user_id, fund_id),
  CONSTRAINT holdings_id_user_uk UNIQUE (id, user_id),
  CONSTRAINT holdings_id_user_fund_uk UNIQUE (id, user_id, fund_id),
  CONSTRAINT holdings_reserved_within_total CHECK (reserved_units <= total_units)
);

-- holding_lots: acquisition lots for a holding, one per source allotment
-- execution. Composite FKs bind lot -> holding and lot -> source execution to a
-- single owner/fund.
CREATE TABLE holding_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holding_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  fund_id uuid NOT NULL REFERENCES funds(id) ON DELETE RESTRICT,
  source_execution_id uuid NOT NULL,
  acquired_on date NOT NULL,
  cost_basis_paise bigint NOT NULL CHECK (cost_basis_paise >= 0),
  original_units numeric(24, 8) NOT NULL CHECK (original_units > 0),
  remaining_units numeric(24, 8) NOT NULL CHECK (remaining_units >= 0),
  reserved_units numeric(24, 8) NOT NULL DEFAULT 0 CHECK (reserved_units >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT holding_lots_id_holding_user_fund_uk UNIQUE (id, holding_id, user_id, fund_id),
  CONSTRAINT holding_lots_source_execution_uk UNIQUE (source_execution_id),
  CONSTRAINT holding_lots_holding_fk
    FOREIGN KEY (holding_id, user_id) REFERENCES holdings (id, user_id) ON DELETE RESTRICT,
  CONSTRAINT holding_lots_source_execution_fk
    FOREIGN KEY (source_execution_id, user_id, fund_id)
    REFERENCES investment_executions (id, user_id, fund_id) ON DELETE RESTRICT,
  CONSTRAINT holding_lots_remaining_within_original CHECK (remaining_units <= original_units),
  CONSTRAINT holding_lots_reserved_within_remaining CHECK (reserved_units <= remaining_units)
);

CREATE INDEX holding_lots_holding_idx ON holding_lots (holding_id, acquired_on, id);

-- holding_lot_movements: append-only, authoritative projection source for each
-- lot/holding delta. Composite FKs require the lot, holding, and execution to
-- share one owner/fund.
CREATE TABLE holding_lot_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holding_lot_id uuid NOT NULL,
  holding_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  fund_id uuid NOT NULL REFERENCES funds(id) ON DELETE RESTRICT,
  execution_id uuid NOT NULL,
  movement_type text NOT NULL,
  units_delta numeric(24, 8) NOT NULL CHECK (units_delta <> 0),
  cost_basis_delta_paise bigint NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT holding_lot_movements_lot_fk
    FOREIGN KEY (holding_lot_id, holding_id, user_id, fund_id)
    REFERENCES holding_lots (id, holding_id, user_id, fund_id) ON DELETE RESTRICT,
  CONSTRAINT holding_lot_movements_holding_fk
    FOREIGN KEY (holding_id, user_id, fund_id) REFERENCES holdings (id, user_id, fund_id) ON DELETE RESTRICT,
  CONSTRAINT holding_lot_movements_execution_fk
    FOREIGN KEY (execution_id, user_id, fund_id)
    REFERENCES investment_executions (id, user_id, fund_id) ON DELETE RESTRICT,
  CONSTRAINT holding_lot_movements_type
    CHECK (movement_type IN ('allotment', 'redemption', 'reversal', 'adjustment')),
  -- Allotment adds units; redemption removes units. Reversal/adjustment signs are
  -- domain-enforced against the linked original movement / approved payload.
  CONSTRAINT holding_lot_movements_allotment_sign CHECK (movement_type <> 'allotment' OR units_delta > 0),
  CONSTRAINT holding_lot_movements_redemption_sign CHECK (movement_type <> 'redemption' OR units_delta < 0),
  CONSTRAINT holding_lot_movements_execution_type_uk UNIQUE (execution_id, holding_lot_id, movement_type)
);

CREATE INDEX holding_lot_movements_lot_chronology_idx
  ON holding_lot_movements (holding_lot_id, occurred_at, id);

-- redemption_requests: a user's request to redeem units from an order. Stores
-- the finance policy version it evaluated and whether dual approval is required.
CREATE TABLE redemption_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  fund_id uuid NOT NULL REFERENCES funds(id) ON DELETE RESTRICT,
  state redemption_state NOT NULL DEFAULT 'submitted',
  requested_units numeric(24, 8) NOT NULL CHECK (requested_units > 0),
  reserved_units numeric(24, 8) NOT NULL DEFAULT 0 CHECK (reserved_units >= 0),
  estimated_value_paise bigint NOT NULL CHECK (estimated_value_paise > 0),
  finance_policy_version integer NOT NULL
    REFERENCES finance_policy_versions (version) ON DELETE RESTRICT,
  requires_dual_approval boolean NOT NULL,
  submitted_at timestamptz NULL,
  reserved_at timestamptz NULL,
  approved_at timestamptz NULL,
  settled_at timestamptz NULL,
  cancelled_at timestamptz NULL,
  reason_code text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT redemption_requests_order_uk UNIQUE (order_id),
  CONSTRAINT redemption_requests_order_fk
    FOREIGN KEY (order_id, user_id) REFERENCES investment_orders (id, user_id) ON DELETE RESTRICT,
  CONSTRAINT redemption_requests_reserved_within_requested CHECK (reserved_units <= requested_units)
);

CREATE INDEX redemption_requests_user_history_idx
  ON redemption_requests (user_id, created_at DESC, id DESC);
CREATE INDEX redemption_requests_ops_queue_idx ON redemption_requests (state, updated_at, id);

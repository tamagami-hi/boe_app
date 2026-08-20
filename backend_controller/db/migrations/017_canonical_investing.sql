-- Canonical investing schema (target persistence model, spec §5.1/§5.5/§5.6/§5.9).
-- Greenfield baseline: orders, private admin reviews, and private allocations.
-- Money is integer paise in bigint. Ownership is carried as composite
-- (…, user_id[/…, fund_id]) foreign keys so a row can never reference another
-- user's data. There are no units, no NAV, no holdings/lots/movements, no
-- mandates, and no redemption requests in this baseline.
--
-- Boundary rule: nothing here reads or writes fund AUM; an accepted investment
-- produces a client contribution (018, client_value_entries) and never an AUM
-- record.

DO $$ BEGIN
  CREATE TYPE order_type AS ENUM ('lump_sum', 'sip_installment');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE order_state AS ENUM (
    'submitted', 'payment_pending', 'review_pending', 'accepted',
    'refund_pending', 'refunded', 'refund_failed', 'payment_failed', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE review_state AS ENUM ('pending', 'accepted', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE client_value_entry_type AS ENUM ('contribution', 'growth_adjustment', 'reversal');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ledger_actor_type AS ENUM ('admin', 'system');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE sip_state AS ENUM (
    'draft', 'pending_mandate', 'active', 'paused', 'cancelled', 'completed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- sip_plans: a user's recurring purchase schedule for a fund. Minimal anchor
-- for installment orders; PhonePe AutoPay mandate linkage is added by the
-- recurring-rail phase, which owns the provider contract. `(id, user_id)` is
-- the composite ownership anchor referenced by `investment_orders`.
CREATE TABLE sip_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  fund_id uuid NOT NULL REFERENCES funds(id) ON DELETE RESTRICT,
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  debit_day integer NOT NULL CHECK (debit_day >= 1 AND debit_day <= 28),
  duration_months integer NULL CHECK (duration_months IS NULL OR duration_months > 0),
  state sip_state NOT NULL DEFAULT 'draft',
  start_date date NULL,
  next_due_date date NULL,
  paused_at timestamptz NULL,
  cancelled_at timestamptz NULL,
  completed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT sip_plans_id_user_uk UNIQUE (id, user_id),
  CONSTRAINT sip_plans_paused_ts CHECK (state <> 'paused' OR paused_at IS NOT NULL),
  CONSTRAINT sip_plans_cancelled_ts CHECK (state <> 'cancelled' OR cancelled_at IS NOT NULL),
  CONSTRAINT sip_plans_completed_ts CHECK (state <> 'completed' OR completed_at IS NOT NULL)
);

CREATE INDEX sip_plans_user_history_idx ON sip_plans (user_id, created_at DESC, id DESC);
CREATE INDEX sip_plans_ops_queue_idx ON sip_plans (state, updated_at, id);

-- investment_orders (spec §5.1): a single client intent (one-time lump sum or
-- SIP installment). The selected issued fund version is stored so later
-- catalogue changes cannot rewrite the terms the client accepted; fund and
-- version are tied by a composite foreign key. No bank-verification or
-- operational allocation fields live on the order. `(id, user_id)` and
-- `(id, user_id, fund_id)` anchor downstream ownership/provenance FKs.
CREATE TABLE investment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  fund_id uuid NOT NULL REFERENCES funds(id) ON DELETE RESTRICT,
  fund_version_id uuid NOT NULL,
  sip_plan_id uuid NULL,
  type order_type NOT NULL,
  state order_state NOT NULL DEFAULT 'submitted',
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  currency char(3) NOT NULL DEFAULT 'INR',
  requested_at timestamptz NOT NULL DEFAULT now(),
  payment_confirmed_at timestamptz NULL,
  accepted_at timestamptz NULL,
  cancelled_at timestamptz NULL,
  failure_code text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT investment_orders_id_user_uk UNIQUE (id, user_id),
  CONSTRAINT investment_orders_id_user_fund_uk UNIQUE (id, user_id, fund_id),
  CONSTRAINT investment_orders_fund_version_fk
    FOREIGN KEY (fund_version_id, fund_id) REFERENCES fund_versions (id, fund_id) ON DELETE RESTRICT,
  CONSTRAINT investment_orders_sip_fk
    FOREIGN KEY (sip_plan_id, user_id) REFERENCES sip_plans (id, user_id) ON DELETE RESTRICT,
  -- A SIP installment must name its plan; a lump sum never does.
  CONSTRAINT investment_orders_sip_link
    CHECK ((type = 'sip_installment') = (sip_plan_id IS NOT NULL)),
  CONSTRAINT investment_orders_accepted_ts CHECK (state <> 'accepted' OR accepted_at IS NOT NULL),
  CONSTRAINT investment_orders_cancelled_ts CHECK (state <> 'cancelled' OR cancelled_at IS NOT NULL)
);

CREATE INDEX investment_orders_user_history_idx ON investment_orders (user_id, created_at DESC, id DESC);
CREATE INDEX investment_orders_ops_queue_idx ON investment_orders (state, updated_at, id);

-- investment_reviews (spec §5.5): admin-only, one-to-one with the order. The
-- pending row is created when PhonePe reports the payment succeeded, in the
-- same transaction as the payment/order transition. This row is never returned
-- from client routes; `bank_verified` is an admin attestation, not PhonePe
-- proof.
CREATE TABLE investment_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES investment_orders(id) ON DELETE RESTRICT,
  state review_state NOT NULL DEFAULT 'pending',
  bank_verified boolean NOT NULL DEFAULT false,
  reviewed_by_user_id uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason_code text NULL,
  private_note text NULL,
  reviewed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT investment_reviews_order_uk UNIQUE (order_id),
  -- A pending review has no reviewer and no reviewed timestamp.
  CONSTRAINT investment_reviews_pending_shape CHECK (
    state <> 'pending' OR (reviewed_by_user_id IS NULL AND reviewed_at IS NULL)
  ),
  -- A terminal review names its reviewer and when it concluded.
  CONSTRAINT investment_reviews_terminal_shape CHECK (
    state = 'pending' OR (reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL)
  ),
  -- Acceptance is only possible on a bank-verified review.
  CONSTRAINT investment_reviews_accepted_bank_verified CHECK (
    state <> 'accepted' OR bank_verified
  ),
  -- Rejection must say why (public-safe reason code).
  CONSTRAINT investment_reviews_rejected_reason CHECK (
    state <> 'rejected' OR (reason_code IS NOT NULL AND btrim(reason_code) <> '')
  )
);

CREATE INDEX investment_reviews_queue_idx ON investment_reviews (state, created_at, id);

-- investment_allocations (spec §5.6): admin-only, exactly one per accepted
-- order, for the full succeeded payment, to the order's immutable selected
-- fund. The composite FK ties allocation, order, user, and fund together.
CREATE TABLE investment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  fund_id uuid NOT NULL REFERENCES funds(id) ON DELETE RESTRICT,
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  allocated_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  allocated_at timestamptz NOT NULL DEFAULT now(),
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT investment_allocations_order_uk UNIQUE (order_id),
  CONSTRAINT investment_allocations_request_uk UNIQUE (request_id),
  CONSTRAINT investment_allocations_id_user_fund_uk UNIQUE (id, user_id, fund_id),
  CONSTRAINT investment_allocations_order_fk
    FOREIGN KEY (order_id, user_id, fund_id)
    REFERENCES investment_orders (id, user_id, fund_id) ON DELETE RESTRICT
);

-- Client growth batch header (spec §5.9): one audited admin command that
-- produced zero or more client_value_entries growth adjustments. Structurally
-- separate from aum_growth_batches; no batch id spans both growth domains.
CREATE TABLE client_growth_batches (
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
  CONSTRAINT client_growth_batches_idempotency_uk UNIQUE (idempotency_record_id)
);

CREATE INDEX client_growth_batches_request_idx ON client_growth_batches (request_id);

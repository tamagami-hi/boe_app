DO $$ BEGIN
  CREATE TYPE investment_plan_type AS ENUM ('sip', 'one_time');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE investment_plan_status AS ENUM (
    'draft',
    'submitted',
    'pending_first_payment',
    'first_payment_failed',
    'pending_mandate_setup',
    'mandate_pending_user_auth',
    'active',
    'installment_due',
    'installment_processing',
    'installment_success',
    'installment_failed',
    'skip_requested',
    'paused',
    'step_up_scheduled',
    'change_requested',
    'cancel_requested',
    'cancelled',
    'matured',
    'withdrawal_requested',
    'closed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE transaction_type AS ENUM (
    'sip_installment',
    'one_time_investment',
    'redemption',
    'fee',
    'adjustment',
    'refund'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE transaction_status AS ENUM (
    'draft',
    'submitted',
    'payment_pending',
    'payment_failed',
    'payment_confirmed',
    'allotted',
    'cancelled',
    'reversed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM (
    'created',
    'gateway_initiated',
    'pending',
    'success',
    'failed',
    'expired',
    'refunded',
    'reconciled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE mandate_status AS ENUM (
    'not_required',
    'setup_required',
    'created',
    'pending_user_auth',
    'active',
    'paused',
    'revoked',
    'failed',
    'expired'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE statement_status AS ENUM ('queued', 'generated', 'failed', 'voided');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS investment_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
  type investment_plan_type NOT NULL,
  amount numeric(18, 2) NOT NULL,
  duration_months integer,
  debit_day integer,
  status investment_plan_status NOT NULL DEFAULT 'draft',
  mandate_id uuid,
  start_date date,
  next_due_date date,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT investment_plans_amount_chk CHECK (amount > 0),
  CONSTRAINT investment_plans_duration_chk CHECK (duration_months IS NULL OR duration_months > 0),
  CONSTRAINT investment_plans_debit_day_chk CHECK (debit_day IS NULL OR debit_day BETWEEN 1 AND 28),
  CONSTRAINT investment_plans_sip_schedule_chk CHECK (
    (type = 'sip' AND duration_months IS NOT NULL AND debit_day IS NOT NULL)
    OR (type = 'one_time' AND duration_months IS NULL AND debit_day IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS investment_plans_user_id_status_idx ON investment_plans (user_id, status);
CREATE INDEX IF NOT EXISTS investment_plans_product_id_idx ON investment_plans (product_id);
CREATE INDEX IF NOT EXISTS investment_plans_next_due_date_idx ON investment_plans (next_due_date) WHERE next_due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS investment_plans_created_at_idx ON investment_plans (created_at DESC);

CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
  investment_plan_id uuid REFERENCES investment_plans (id) ON DELETE SET NULL,
  type transaction_type NOT NULL,
  amount numeric(18, 2) NOT NULL,
  nav numeric(18, 6),
  units numeric(24, 8),
  status transaction_status NOT NULL DEFAULT 'draft',
  idempotency_key text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  payment_confirmed_at timestamptz,
  allotted_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transactions_amount_chk CHECK (amount > 0),
  CONSTRAINT transactions_nav_chk CHECK (nav IS NULL OR nav > 0),
  CONSTRAINT transactions_units_chk CHECK (units IS NULL OR units >= 0),
  CONSTRAINT transactions_allotment_chk CHECK (
    status <> 'allotted'
    OR (allotted_at IS NOT NULL AND nav IS NOT NULL AND units IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS transactions_idempotency_key_uidx
  ON transactions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS transactions_user_id_created_at_idx ON transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transactions_product_id_created_at_idx ON transactions (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transactions_investment_plan_id_idx ON transactions (investment_plan_id);
CREATE INDEX IF NOT EXISTS transactions_status_idx ON transactions (status);

CREATE TABLE IF NOT EXISTS mandates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  investment_plan_id uuid REFERENCES investment_plans (id) ON DELETE SET NULL,
  provider text NOT NULL,
  provider_mandate_id text,
  max_amount numeric(18, 2) NOT NULL,
  frequency text NOT NULL,
  debit_day integer,
  status mandate_status NOT NULL DEFAULT 'setup_required',
  idempotency_key text,
  valid_from date,
  valid_to date,
  last_debit_at timestamptz,
  next_debit_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mandates_max_amount_chk CHECK (max_amount > 0),
  CONSTRAINT mandates_frequency_chk CHECK (frequency IN ('monthly', 'quarterly', 'half_yearly', 'yearly')),
  CONSTRAINT mandates_debit_day_chk CHECK (debit_day IS NULL OR debit_day BETWEEN 1 AND 28),
  CONSTRAINT mandates_validity_chk CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS mandates_provider_mandate_uidx
  ON mandates (provider, provider_mandate_id)
  WHERE provider_mandate_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS mandates_idempotency_key_uidx
  ON mandates (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS mandates_active_plan_uidx
  ON mandates (investment_plan_id)
  WHERE investment_plan_id IS NOT NULL AND status IN ('created', 'pending_user_auth', 'active', 'paused');
CREATE INDEX IF NOT EXISTS mandates_user_id_status_idx ON mandates (user_id, status);
CREATE INDEX IF NOT EXISTS mandates_next_debit_at_idx ON mandates (next_debit_at) WHERE next_debit_at IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE investment_plans
    ADD CONSTRAINT investment_plans_mandate_fk
    FOREIGN KEY (mandate_id) REFERENCES mandates (id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  transaction_id uuid REFERENCES transactions (id) ON DELETE SET NULL,
  provider text NOT NULL,
  provider_payment_id text,
  amount numeric(18, 2) NOT NULL,
  currency char(3) NOT NULL DEFAULT 'INR',
  mode text,
  status payment_status NOT NULL DEFAULT 'created',
  failure_reason text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  reconciled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_amount_chk CHECK (amount > 0),
  CONSTRAINT payments_currency_chk CHECK (currency = upper(currency)),
  CONSTRAINT payments_success_confirmed_chk CHECK (status <> 'success' OR confirmed_at IS NOT NULL),
  CONSTRAINT payments_reconciled_chk CHECK (status <> 'reconciled' OR reconciled_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_payment_uidx
  ON payments (provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payments_idempotency_key_uidx
  ON payments (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_user_id_created_at_idx ON payments (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_transaction_id_idx ON payments (transaction_id);
CREATE INDEX IF NOT EXISTS payments_status_idx ON payments (status);
CREATE INDEX IF NOT EXISTS payments_reconciled_at_idx ON payments (reconciled_at DESC) WHERE reconciled_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  payment_id uuid REFERENCES payments (id) ON DELETE SET NULL,
  signature_valid boolean NOT NULL DEFAULT false,
  payload_json jsonb NOT NULL,
  processed_at timestamptz,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_webhook_events_provider_event_uidx
  ON payment_webhook_events (provider, provider_event_id);
CREATE UNIQUE INDEX IF NOT EXISTS payment_webhook_events_idempotency_key_uidx
  ON payment_webhook_events (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_webhook_events_payment_id_idx ON payment_webhook_events (payment_id);
CREATE INDEX IF NOT EXISTS payment_webhook_events_processed_at_idx ON payment_webhook_events (processed_at);

CREATE TABLE IF NOT EXISTS mandate_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  mandate_id uuid REFERENCES mandates (id) ON DELETE SET NULL,
  signature_valid boolean NOT NULL DEFAULT false,
  payload_json jsonb NOT NULL,
  processed_at timestamptz,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS mandate_webhook_events_provider_event_uidx
  ON mandate_webhook_events (provider, provider_event_id);
CREATE UNIQUE INDEX IF NOT EXISTS mandate_webhook_events_idempotency_key_uidx
  ON mandate_webhook_events (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS mandate_webhook_events_mandate_id_idx ON mandate_webhook_events (mandate_id);
CREATE INDEX IF NOT EXISTS mandate_webhook_events_processed_at_idx ON mandate_webhook_events (processed_at);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  product_id uuid REFERENCES products (id) ON DELETE RESTRICT,
  transaction_id uuid REFERENCES transactions (id) ON DELETE SET NULL,
  entry_type text NOT NULL,
  debit numeric(18, 2) NOT NULL DEFAULT 0,
  credit numeric(18, 2) NOT NULL DEFAULT 0,
  currency char(3) NOT NULL DEFAULT 'INR',
  narration text NOT NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_entries_amount_chk CHECK (debit >= 0 AND credit >= 0 AND debit <> credit),
  CONSTRAINT ledger_entries_currency_chk CHECK (currency = upper(currency)),
  CONSTRAINT ledger_entries_narration_chk CHECK (length(trim(narration)) > 0)
);

CREATE INDEX IF NOT EXISTS ledger_entries_user_id_created_at_idx ON ledger_entries (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ledger_entries_product_id_created_at_idx ON ledger_entries (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ledger_entries_transaction_id_idx ON ledger_entries (transaction_id);
CREATE INDEX IF NOT EXISTS ledger_entries_entry_type_idx ON ledger_entries (entry_type);

-- Portfolio / holding snapshot tables removed per business requirement (NAV/performance tracking no longer needed)
-- CREATE TABLE IF NOT EXISTS portfolio_snapshots (...);
-- CREATE TABLE IF NOT EXISTS holding_snapshots (...);

CREATE TABLE IF NOT EXISTS statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  period text NOT NULL,
  from_date date NOT NULL,
  to_date date NOT NULL,
  generated_at timestamptz,
  document_url text,
  status statement_status NOT NULL DEFAULT 'queued',
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT statements_period_chk CHECK (length(trim(period)) > 0),
  CONSTRAINT statements_dates_chk CHECK (to_date >= from_date),
  CONSTRAINT statements_generated_chk CHECK (
    (status = 'generated' AND generated_at IS NOT NULL AND document_url IS NOT NULL)
    OR status <> 'generated'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS statements_user_period_uidx ON statements (user_id, period);
CREATE INDEX IF NOT EXISTS statements_user_created_at_idx ON statements (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS statements_status_idx ON statements (status);

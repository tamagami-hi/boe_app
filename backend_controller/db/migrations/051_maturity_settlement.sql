ALTER TABLE client_value_entries
  ADD CONSTRAINT client_value_entries_withdrawal_shape CHECK (
    entry_type <> 'withdrawal'
    OR (
      value_delta_paise < 0
      AND principal_delta_paise <= 0
      AND (-principal_delta_paise) <= (-value_delta_paise)
      AND order_id IS NULL
      AND payment_id IS NULL
      AND growth_batch_id IS NULL
      AND actor_type = 'admin'
      AND created_by_user_id IS NOT NULL
    )
  );

ALTER TABLE client_value_entries
  ADD CONSTRAINT client_value_entries_maturity_reinvestment_shape CHECK (
    entry_type <> 'maturity_reinvestment'
    OR (
      value_delta_paise = 0
      AND principal_delta_paise <> 0
      AND order_id IS NULL
      AND payment_id IS NULL
      AND growth_batch_id IS NULL
      AND actor_type = 'admin'
      AND created_by_user_id IS NOT NULL
    )
  );

DO $$ BEGIN
  CREATE TYPE maturity_state AS ENUM ('pending', 'settled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE maturity_settlement AS ENUM ('withdrawal', 'reinvestment');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE withdrawal_state AS ENUM ('pending', 'paid', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE client_position_maturities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  fund_id uuid NOT NULL REFERENCES funds(id) ON DELETE RESTRICT,
  state maturity_state NOT NULL DEFAULT 'pending',
  matured_on date NOT NULL,
  principal_at_maturity_paise bigint NOT NULL CHECK (principal_at_maturity_paise >= 0),
  value_at_maturity_paise bigint NOT NULL CHECK (value_at_maturity_paise >= 0),
  settlement maturity_settlement NULL,
  settled_at timestamptz NULL,
  settlement_entry_id uuid NULL,
  reason_code text NOT NULL CHECK (btrim(reason_code) <> ''),
  note text NULL,
  marked_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT client_position_maturities_id_user_uk UNIQUE (id, user_id, fund_id),
  CONSTRAINT client_position_maturities_settlement_entry_fk
    FOREIGN KEY (settlement_entry_id, user_id, fund_id)
    REFERENCES client_value_entries (id, user_id, fund_id) ON DELETE RESTRICT,
  CONSTRAINT client_position_maturities_shape CHECK (
    (state = 'pending' AND settlement IS NULL AND settled_at IS NULL AND settlement_entry_id IS NULL)
    OR (state = 'settled' AND settlement IS NOT NULL AND settled_at IS NOT NULL AND settlement_entry_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX client_position_maturities_open_uk
  ON client_position_maturities (user_id, fund_id)
  WHERE state = 'pending';

CREATE UNIQUE INDEX client_position_maturities_settlement_entry_uk
  ON client_position_maturities (settlement_entry_id)
  WHERE settlement_entry_id IS NOT NULL;

CREATE INDEX client_position_maturities_ops_queue_idx
  ON client_position_maturities (state, updated_at, id);

CREATE TABLE withdrawal_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  fund_id uuid NOT NULL REFERENCES funds(id) ON DELETE RESTRICT,
  maturity_id uuid NOT NULL,
  ledger_entry_id uuid NOT NULL,
  state withdrawal_state NOT NULL DEFAULT 'pending',
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  growth_portion_paise bigint NOT NULL CHECK (growth_portion_paise >= 0),
  principal_portion_paise bigint NOT NULL CHECK (principal_portion_paise >= 0),
  currency char(3) NOT NULL DEFAULT 'INR',
  effective_date date NOT NULL,
  transfer_reference text NULL,
  failure_code text NULL CHECK (
    failure_code IS NULL
    OR (length(failure_code) BETWEEN 1 AND 128 AND failure_code ~ '^[A-Za-z0-9_.:-]+$')
  ),
  paid_at timestamptz NULL,
  failed_at timestamptz NULL,
  reason_code text NOT NULL CHECK (btrim(reason_code) <> ''),
  note text NULL,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  CONSTRAINT withdrawal_operations_ledger_entry_uk UNIQUE (ledger_entry_id),
  CONSTRAINT withdrawal_operations_maturity_uk UNIQUE (maturity_id),
  CONSTRAINT withdrawal_operations_currency CHECK (currency = 'INR'),
  CONSTRAINT withdrawal_operations_maturity_fk
    FOREIGN KEY (maturity_id, user_id, fund_id)
    REFERENCES client_position_maturities (id, user_id, fund_id) ON DELETE RESTRICT,
  CONSTRAINT withdrawal_operations_ledger_entry_fk
    FOREIGN KEY (ledger_entry_id, user_id, fund_id)
    REFERENCES client_value_entries (id, user_id, fund_id) ON DELETE RESTRICT,
  CONSTRAINT withdrawal_operations_portions CHECK (
    growth_portion_paise + principal_portion_paise = amount_paise
  ),
  CONSTRAINT withdrawal_operations_shape CHECK (
    (state = 'pending' AND paid_at IS NULL AND failed_at IS NULL AND failure_code IS NULL AND transfer_reference IS NULL)
    OR (state = 'paid' AND paid_at IS NOT NULL AND failed_at IS NULL AND failure_code IS NULL AND transfer_reference IS NOT NULL AND btrim(transfer_reference) <> '')
    OR (state = 'failed' AND failed_at IS NOT NULL AND failure_code IS NOT NULL AND paid_at IS NULL AND transfer_reference IS NULL)
  )
);

CREATE INDEX withdrawal_operations_ops_queue_idx
  ON withdrawal_operations (state, updated_at, id);

CREATE INDEX withdrawal_operations_user_history_idx
  ON withdrawal_operations (user_id, created_at DESC, id DESC);

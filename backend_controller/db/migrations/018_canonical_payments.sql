-- Canonical payments, provider inbox, and client value ledger schema (target
-- persistence model, spec §5.2/§5.3/§5.4/§5.7). Ordered after 017 because
-- payments reference investment_orders and client_value_entries reference
-- payments, allocations, and client growth batches. Money is integer paise in
-- bigint. Raw financial-provider payloads are AES-256-GCM encrypted and
-- erasable (digest + outcome retained). Ownership is carried by composite
-- (…, user_id) foreign keys.
--
-- PhonePe is the only payment provider. Provider success is evidence of
-- payment, not acceptance of an investment: a succeeded payment produces an
-- admin review (017), never a client contribution or an AUM record.

DO $$ BEGIN
  CREATE TYPE payment_state AS ENUM (
    'created', 'provider_pending', 'succeeded', 'failed', 'expired',
    'refund_pending', 'refunded', 'refund_failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE provider_event_state AS ENUM ('received', 'processing', 'processed', 'dead_lettered');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE refund_state AS ENUM ('pending', 'provider_pending', 'refunded', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- payments: one payment per investment order. `(id, user_id)` is unique before
-- any referencing composite FK (payment_attempts, provider_events,
-- client_value_entries).
CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  currency char(3) NOT NULL DEFAULT 'INR',
  state payment_state NOT NULL DEFAULT 'created',
  succeeded_at timestamptz NULL,
  failed_at timestamptz NULL,
  refunded_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT payments_order_uk UNIQUE (order_id),
  CONSTRAINT payments_id_user_uk UNIQUE (id, user_id),
  CONSTRAINT payments_order_fk
    FOREIGN KEY (order_id, user_id) REFERENCES investment_orders (id, user_id) ON DELETE RESTRICT,
  CONSTRAINT payments_succeeded_ts CHECK (state <> 'succeeded' OR succeeded_at IS NOT NULL),
  CONSTRAINT payments_failed_ts CHECK (state <> 'failed' OR failed_at IS NOT NULL),
  CONSTRAINT payments_refunded_ts CHECK (state <> 'refunded' OR refunded_at IS NOT NULL)
);

CREATE INDEX payments_user_history_idx ON payments (user_id, created_at DESC, id DESC);
CREATE INDEX payments_ops_queue_idx ON payments (state, updated_at, id);

-- payment_attempts: PhonePe checkout attempts against a payment. One app-
-- created attempt and merchant order id is live at a time; an explicit retry
-- after a terminal failed/expired attempt creates a new attempt with a new
-- merchant order id. `merchant_order_id` is server-generated, unique, at most
-- 63 characters, letters/digits/`_`/`-` only, and immutable once written.
-- State is limited to the non-refund lifecycle; refunds are first-class
-- refund_operations rows against the parent payment.
CREATE TABLE payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  provider text NOT NULL CHECK (provider = 'phonepe'),
  merchant_order_id text NOT NULL,
  provider_order_id text NULL,
  state payment_state NOT NULL DEFAULT 'created',
  failure_code text NULL,
  checkout_expires_at timestamptz NULL,
  last_status_checked_at timestamptz NULL,
  -- Terminal/non-terminal state last reported by the provider (e.g. COMPLETED).
  provider_state text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT payment_attempts_number_uk UNIQUE (payment_id, attempt_number),
  CONSTRAINT payment_attempts_id_user_uk UNIQUE (id, user_id),
  CONSTRAINT payment_attempts_merchant_order_uk UNIQUE (merchant_order_id),
  CONSTRAINT payment_attempts_merchant_order_format CHECK (
    length(merchant_order_id) <= 63 AND merchant_order_id ~ '^[A-Za-z0-9_-]+$'
  ),
  CONSTRAINT payment_attempts_payment_fk
    FOREIGN KEY (payment_id, user_id) REFERENCES payments (id, user_id) ON DELETE RESTRICT,
  CONSTRAINT payment_attempts_state
    CHECK (state IN ('created', 'provider_pending', 'succeeded', 'failed', 'expired'))
);

-- Unique provider reference: one provider order maps to at most one attempt.
CREATE UNIQUE INDEX payment_attempts_provider_pair_uk
  ON payment_attempts (provider, provider_order_id)
  WHERE provider_order_id IS NOT NULL;

-- provider_payment_details (spec §5.2): normalized PhonePe `paymentDetails[]`.
-- One merchant order may produce multiple details because of retries or split
-- instruments, so details are child rows keyed by attempt plus provider
-- transaction — never a single overwritten transaction-id column.
CREATE TABLE provider_payment_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_attempt_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider_transaction_id text NOT NULL CHECK (btrim(provider_transaction_id) <> ''),
  provider_reference text NULL,
  instrument_type text NULL,
  state text NULL,
  amount_paise bigint NULL CHECK (amount_paise IS NULL OR amount_paise > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_payment_details_attempt_txn_uk UNIQUE (payment_attempt_id, provider_transaction_id),
  CONSTRAINT provider_payment_details_attempt_fk
    FOREIGN KEY (payment_attempt_id, user_id)
    REFERENCES payment_attempts (id, user_id) ON DELETE RESTRICT
);

CREATE INDEX provider_payment_details_attempt_idx
  ON provider_payment_details (payment_attempt_id, created_at, id);

-- refund_operations (spec §5.3): first-class refund record for a rejected
-- succeeded payment. The stable merchant refund id is persisted before any
-- provider call and reused for crash recovery/reconciliation. The amount is
-- the full succeeded payment for this MVP.
CREATE TABLE refund_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES investment_orders(id) ON DELETE RESTRICT,
  merchant_refund_id text NOT NULL,
  provider_refund_id text NULL,
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  state refund_state NOT NULL DEFAULT 'pending',
  failure_code text NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_status_checked_at timestamptz NULL,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT refund_operations_payment_uk UNIQUE (payment_id),
  CONSTRAINT refund_operations_order_uk UNIQUE (order_id),
  CONSTRAINT refund_operations_merchant_refund_uk UNIQUE (merchant_refund_id),
  CONSTRAINT refund_operations_merchant_refund_format CHECK (
    length(merchant_refund_id) <= 63 AND merchant_refund_id ~ '^[A-Za-z0-9_-]+$'
  )
);

CREATE INDEX refund_operations_ops_queue_idx ON refund_operations (state, updated_at, id);

-- provider_events (spec §5.4): durable inbox for signed inbound PhonePe
-- callbacks. Callback authorization is verified against the exact raw bytes
-- before any business change (CHECK signature_valid). The deduplication key is
-- semantic — event + merchant order/provider order/refund id + resulting
-- state — because semantically identical payloads can serialize differently;
-- the raw digest remains evidence but is not the sole dedup key. The encrypted
-- payload envelope is all-present before erasure and all-null after erased_at;
-- the digest and processing outcome are retained after erasure.
CREATE TABLE provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (btrim(provider) <> ''),
  event_type text NOT NULL CHECK (btrim(event_type) <> ''),
  dedup_key text NOT NULL CHECK (btrim(dedup_key) <> ''),
  state provider_event_state NOT NULL DEFAULT 'received',
  signature_valid boolean NOT NULL,
  payload_ciphertext bytea NULL,
  payload_nonce bytea NULL,
  payload_key_version text NULL,
  payload_sha256 bytea NOT NULL CHECK (octet_length(payload_sha256) = 32),
  erased_at timestamptz NULL,
  -- Merchant-order correlation; the optional payment FK is attached once the
  -- owning payment is known.
  merchant_order_id text NULL,
  payment_id uuid NULL,
  user_id uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz NULL,
  locked_by text NULL,
  processed_at timestamptz NULL,
  last_error_code text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT provider_events_dedup_uk UNIQUE (provider, dedup_key),
  -- Composite subject FK binds an event to the same user as its payment when
  -- the subject exists (MATCH SIMPLE: enforced only when both columns set).
  CONSTRAINT provider_events_payment_fk
    FOREIGN KEY (payment_id, user_id) REFERENCES payments (id, user_id) ON DELETE RESTRICT,
  CONSTRAINT provider_events_signature_valid CHECK (signature_valid),
  CONSTRAINT provider_events_active_envelope CHECK (
    erased_at IS NOT NULL OR (
      payload_ciphertext IS NOT NULL
      AND payload_nonce IS NOT NULL AND octet_length(payload_nonce) = 12
      AND payload_key_version IS NOT NULL
    )
  ),
  CONSTRAINT provider_events_erased_envelope CHECK (
    erased_at IS NULL OR (
      payload_ciphertext IS NULL AND payload_nonce IS NULL AND payload_key_version IS NULL
    )
  ),
  CONSTRAINT provider_events_lease_coherent CHECK ((locked_at IS NULL) = (locked_by IS NULL)),
  CONSTRAINT provider_events_processed_ts CHECK (state <> 'processed' OR processed_at IS NOT NULL)
);

-- Claim index for the worker: unprocessed events ready to be leased.
CREATE INDEX provider_events_claim_idx
  ON provider_events (available_at, created_at, id)
  WHERE state = 'received';

-- client_value_entries (spec §5.7): the append-only client value ledger.
-- Placed after payments because contributions carry payment provenance.
-- Corrections are a reversal followed by a correct new entry; application
-- roles never UPDATE or DELETE.
--
-- Shapes:
--   contribution:      principal_delta = value_delta = accepted payment
--                      amount; order/payment/allocation required.
--   growth_adjustment: principal_delta = 0; value_delta = signed admin
--                      adjustment; growth batch and admin actor required.
--   reversal:          exact negation of one prior entry for the same user and
--                      fund; only reversal rows carry reverses_entry_id; one
--                      original row is reversed at most once (unique index).
CREATE TABLE client_value_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  fund_id uuid NOT NULL REFERENCES funds(id) ON DELETE RESTRICT,
  allocation_id uuid NULL,
  entry_type client_value_entry_type NOT NULL,
  principal_delta_paise bigint NOT NULL,
  value_delta_paise bigint NOT NULL,
  effective_date date NOT NULL,
  order_id uuid NULL,
  payment_id uuid NULL,
  growth_batch_id uuid NULL REFERENCES client_growth_batches(id) ON DELETE RESTRICT,
  reason_code text NOT NULL CHECK (btrim(reason_code) <> ''),
  note text NULL,
  reverses_entry_id uuid NULL,
  actor_type ledger_actor_type NOT NULL,
  created_by_user_id uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT client_value_entries_id_user_fund_uk UNIQUE (id, user_id, fund_id),
  -- Composite provenance: a row can never reference another user's order,
  -- payment, or allocation.
  CONSTRAINT client_value_entries_order_fk
    FOREIGN KEY (order_id, user_id) REFERENCES investment_orders (id, user_id) ON DELETE RESTRICT,
  CONSTRAINT client_value_entries_payment_fk
    FOREIGN KEY (payment_id, user_id) REFERENCES payments (id, user_id) ON DELETE RESTRICT,
  CONSTRAINT client_value_entries_allocation_fk
    FOREIGN KEY (allocation_id, user_id, fund_id)
    REFERENCES investment_allocations (id, user_id, fund_id) ON DELETE RESTRICT,
  CONSTRAINT client_value_entries_reverses_fk
    FOREIGN KEY (reverses_entry_id, user_id, fund_id)
    REFERENCES client_value_entries (id, user_id, fund_id) ON DELETE RESTRICT,
  CONSTRAINT client_value_entries_contribution_shape CHECK (
    entry_type <> 'contribution'
    OR (
      principal_delta_paise > 0
      AND value_delta_paise = principal_delta_paise
      AND order_id IS NOT NULL
      AND payment_id IS NOT NULL
      AND allocation_id IS NOT NULL
    )
  ),
  CONSTRAINT client_value_entries_growth_shape CHECK (
    entry_type <> 'growth_adjustment'
    OR (
      principal_delta_paise = 0
      AND value_delta_paise <> 0
      AND growth_batch_id IS NOT NULL
      AND actor_type = 'admin'
      AND created_by_user_id IS NOT NULL
    )
  ),
  -- Only a contribution carries allocation provenance; only a reversal names
  -- the entry it reverses.
  CONSTRAINT client_value_entries_allocation_link
    CHECK ((entry_type = 'contribution') = (allocation_id IS NOT NULL)),
  CONSTRAINT client_value_entries_reversal_link
    CHECK ((entry_type = 'reversal') = (reverses_entry_id IS NOT NULL)),
  -- Growth entries never attach order/payment provenance.
  CONSTRAINT client_value_entries_growth_provenance CHECK (
    entry_type <> 'growth_adjustment' OR (order_id IS NULL AND payment_id IS NULL)
  ),
  -- `actor_type=admin` iff `created_by_user_id` is present.
  CONSTRAINT client_value_entries_actor CHECK (
    (actor_type = 'admin') = (created_by_user_id IS NOT NULL)
  )
);

-- One contribution per order and per payment.
CREATE UNIQUE INDEX client_value_entries_order_contribution_uk
  ON client_value_entries (order_id)
  WHERE entry_type = 'contribution';
CREATE UNIQUE INDEX client_value_entries_payment_contribution_uk
  ON client_value_entries (payment_id)
  WHERE entry_type = 'contribution';
-- One growth entry per (batch, user, fund).
CREATE UNIQUE INDEX client_value_entries_growth_target_uk
  ON client_value_entries (growth_batch_id, user_id, fund_id)
  WHERE growth_batch_id IS NOT NULL;
-- One original row is reversed at most once.
CREATE UNIQUE INDEX client_value_entries_reverses_uk
  ON client_value_entries (reverses_entry_id)
  WHERE reverses_entry_id IS NOT NULL;

-- Derivation reads the whole ledger for one (user, fund) or one user.
CREATE INDEX client_value_entries_user_idx
  ON client_value_entries (user_id, effective_date, created_at, id);
CREATE INDEX client_value_entries_user_fund_idx
  ON client_value_entries (user_id, fund_id, effective_date, created_at, id);
CREATE INDEX client_value_entries_fund_idx
  ON client_value_entries (fund_id, effective_date);

-- notifications: user-facing messages. No provider payload, token, KYC
-- identifier, or sensitive audit detail; allowlisted JSON object payload only.
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (btrim(kind) <> ''),
  title text NOT NULL CHECK (btrim(title) <> ''),
  body text NOT NULL,
  read_at timestamptz NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notifications_payload_object CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX notifications_user_inbox_idx ON notifications (user_id, read_at, created_at DESC);

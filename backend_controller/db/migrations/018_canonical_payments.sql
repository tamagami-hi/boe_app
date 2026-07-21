-- BE-021 (later-domain slice, increment 2): canonical payments and provider
-- inbox schema (spec 03 §4.4). Additive on the canonical baseline (>= 009) and
-- ordered after 017 because payments reference investment_orders and
-- provider_events may reference payments and mandates. Money is integer paise in
-- bigint. Raw financial-provider payloads are AES-256-GCM encrypted and erasable
-- (digest + outcome retained). Ownership is carried by composite (…, user_id)
-- foreign keys.

DO $$ BEGIN
  CREATE TYPE payment_state AS ENUM (
    'created', 'provider_pending', 'succeeded', 'failed', 'expired', 'refunded'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE provider_event_state AS ENUM ('received', 'processing', 'processed', 'dead_lettered');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- payments: one payment per investment order. `(id, user_id)` is unique before
-- any referencing composite FK (payment_attempts, provider_events).
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

-- payment_attempts: provider attempts against a payment. State is limited to the
-- non-refund lifecycle; refunds are recorded on the parent payment.
CREATE TABLE payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  provider text NOT NULL CHECK (btrim(provider) <> ''),
  provider_payment_id text NULL,
  state payment_state NOT NULL DEFAULT 'created',
  failure_code text NULL,
  expires_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT payment_attempts_number_uk UNIQUE (payment_id, attempt_number),
  CONSTRAINT payment_attempts_payment_fk
    FOREIGN KEY (payment_id, user_id) REFERENCES payments (id, user_id) ON DELETE RESTRICT,
  CONSTRAINT payment_attempts_state
    CHECK (state IN ('created', 'provider_pending', 'succeeded', 'failed', 'expired'))
);

CREATE UNIQUE INDEX payment_attempts_provider_pair_uk
  ON payment_attempts (provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

-- provider_events: signed inbound financial-provider events. Invalid signatures
-- are rejected before any business change (CHECK signature_valid). The encrypted
-- payload envelope is all-present before erasure and all-null after erased_at;
-- the digest and processing outcome are retained after erasure.
CREATE TABLE provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (btrim(provider) <> ''),
  provider_event_id text NOT NULL CHECK (btrim(provider_event_id) <> ''),
  event_type text NOT NULL CHECK (btrim(event_type) <> ''),
  state provider_event_state NOT NULL DEFAULT 'received',
  signature_valid boolean NOT NULL,
  payload_ciphertext bytea NULL,
  payload_nonce bytea NULL,
  payload_key_version text NULL,
  payload_sha256 bytea NOT NULL CHECK (octet_length(payload_sha256) = 32),
  erased_at timestamptz NULL,
  payment_id uuid NULL,
  mandate_id uuid NULL,
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
  CONSTRAINT provider_events_provider_event_uk UNIQUE (provider, provider_event_id),
  -- Composite subject FKs bind an event to the same user as its payment/mandate
  -- when the subject exists (MATCH SIMPLE: enforced only when both columns set).
  CONSTRAINT provider_events_payment_fk
    FOREIGN KEY (payment_id, user_id) REFERENCES payments (id, user_id) ON DELETE RESTRICT,
  CONSTRAINT provider_events_mandate_fk
    FOREIGN KEY (mandate_id, user_id) REFERENCES mandates (id, user_id) ON DELETE RESTRICT,
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

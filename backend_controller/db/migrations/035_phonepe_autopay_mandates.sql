CREATE TYPE sip_collection_mode AS ENUM ('manual_checkout', 'phonepe_autopay');
CREATE TYPE payment_mandate_state AS ENUM (
  'setup_pending',
  'active',
  'pause_pending',
  'paused',
  'cancel_pending',
  'cancelled',
  'revoke_pending',
  'revoked',
  'expired',
  'failed'
);
CREATE TYPE mandate_setup_state AS ENUM ('created', 'dispatching', 'provider_pending', 'authorized', 'failed', 'expired');
CREATE TYPE mandate_notify_state AS ENUM ('created', 'dispatching', 'notified', 'failed');

ALTER TABLE sip_plans
  ADD COLUMN collection_mode sip_collection_mode NOT NULL DEFAULT 'manual_checkout',
  ADD CONSTRAINT sip_plans_id_user_fund_uk UNIQUE (id, user_id, fund_id),
  ADD CONSTRAINT sip_plans_id_user_fund_amount_uk UNIQUE (id, user_id, fund_id, amount_paise);

ALTER TABLE investment_orders
  ADD CONSTRAINT investment_orders_id_sip_user_fund_period_uk UNIQUE (id, sip_plan_id, user_id, fund_id, due_period),
  ADD CONSTRAINT investment_orders_collection_amount_uk
    UNIQUE (id, sip_plan_id, user_id, fund_id, due_period, amount_paise),
  ADD CONSTRAINT investment_orders_sip_user_fund_fk
    FOREIGN KEY (sip_plan_id, user_id, fund_id)
    REFERENCES sip_plans (id, user_id, fund_id) ON DELETE RESTRICT;

ALTER TABLE payments
  ADD CONSTRAINT payments_id_order_user_uk UNIQUE (id, order_id, user_id),
  ADD CONSTRAINT payments_id_order_user_amount_uk UNIQUE (id, order_id, user_id, amount_paise);

ALTER TABLE payment_attempts
  ADD CONSTRAINT payment_attempts_id_payment_user_channel_uk
    UNIQUE (id, payment_id, user_id, checkout_channel),
  DROP CONSTRAINT payment_attempts_checkout_channel_check,
  ADD CONSTRAINT payment_attempts_checkout_channel_check
    CHECK (checkout_channel IN ('hosted_redirect', 'phonepe_mobile_sdk', 'phonepe_autopay'));

CREATE TABLE payment_mandates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sip_plan_id uuid NOT NULL,
  user_id uuid NOT NULL,
  fund_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider = 'phonepe'),
  merchant_subscription_id text NOT NULL CHECK (
    length(merchant_subscription_id) BETWEEN 1 AND 63
    AND merchant_subscription_id ~ '^[A-Za-z0-9_-]+$'
  ),
  provider_subscription_id text NULL,
  state payment_mandate_state NOT NULL DEFAULT 'setup_pending',
  amount_type text NOT NULL CHECK (amount_type = 'fixed'),
  max_amount_paise bigint NOT NULL CHECK (max_amount_paise BETWEEN 100 AND 1500000),
  frequency text NOT NULL CHECK (frequency = 'monthly'),
  authorized_at timestamptz NULL,
  expires_at timestamptz NULL,
  pause_requested_at timestamptz NULL,
  paused_at timestamptz NULL,
  cancellation_requested_at timestamptz NULL,
  completion_requested_at timestamptz NULL,
  revocation_requested_at timestamptz NULL,
  cancelled_at timestamptz NULL,
  revoked_at timestamptz NULL,
  failed_at timestamptz NULL,
  last_status_checked_at timestamptz NULL,
  failure_code text NULL CHECK (
    failure_code IS NULL OR (
      length(failure_code) BETWEEN 1 AND 128
      AND failure_code ~ '^[A-Za-z0-9_.:-]+$'
    )
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  CONSTRAINT payment_mandates_merchant_subscription_uk UNIQUE (merchant_subscription_id),
  CONSTRAINT payment_mandates_provider_subscription_uk UNIQUE (provider, provider_subscription_id),
  CONSTRAINT payment_mandates_id_sip_user_uk UNIQUE (id, sip_plan_id, user_id),
  CONSTRAINT payment_mandates_id_sip_user_fund_uk UNIQUE (id, sip_plan_id, user_id, fund_id),
  CONSTRAINT payment_mandates_collection_amount_uk
    UNIQUE (id, sip_plan_id, user_id, fund_id, max_amount_paise),
  CONSTRAINT payment_mandates_sip_fk
    FOREIGN KEY (sip_plan_id, user_id, fund_id)
    REFERENCES sip_plans (id, user_id, fund_id) ON DELETE RESTRICT,
  CONSTRAINT payment_mandates_state_shape CHECK (
    (state <> 'active' OR authorized_at IS NOT NULL)
    AND (state <> 'pause_pending' OR pause_requested_at IS NOT NULL)
    AND (state <> 'paused' OR paused_at IS NOT NULL)
    AND (state <> 'cancel_pending' OR cancellation_requested_at IS NOT NULL)
    AND (state <> 'revoke_pending' OR revocation_requested_at IS NOT NULL)
    AND (state <> 'cancelled' OR cancelled_at IS NOT NULL)
    AND (state <> 'revoked' OR revoked_at IS NOT NULL)
    AND (state <> 'expired' OR expires_at IS NOT NULL)
    AND (state <> 'failed' OR failed_at IS NOT NULL)
    AND (state <> 'failed' OR failure_code IS NOT NULL)
    AND (
      state NOT IN ('active', 'pause_pending', 'paused', 'cancel_pending', 'revoke_pending')
      OR provider_subscription_id IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX payment_mandates_current_sip_uk
  ON payment_mandates (sip_plan_id)
  WHERE state IN ('setup_pending', 'active', 'pause_pending', 'paused', 'cancel_pending', 'revoke_pending');

CREATE INDEX payment_mandates_owner_idx ON payment_mandates (user_id, created_at DESC, id DESC);
CREATE INDEX payment_mandates_reconciliation_idx
  ON payment_mandates (state, last_status_checked_at, id)
  WHERE state IN ('setup_pending', 'active', 'pause_pending', 'paused', 'cancel_pending', 'revoke_pending');

CREATE FUNCTION prevent_payment_mandate_provider_rebind() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.provider_subscription_id IS NOT NULL
    AND NEW.provider_subscription_id IS DISTINCT FROM OLD.provider_subscription_id THEN
    RAISE EXCEPTION 'provider subscription identity cannot be rebound';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER payment_mandates_provider_rebind_guard
  BEFORE UPDATE OF provider_subscription_id ON payment_mandates
  FOR EACH ROW EXECUTE FUNCTION prevent_payment_mandate_provider_rebind();

CREATE TABLE mandate_setup_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandate_id uuid NOT NULL,
  sip_plan_id uuid NOT NULL,
  user_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  provider text NOT NULL CHECK (provider = 'phonepe'),
  merchant_order_id text NOT NULL CHECK (
    length(merchant_order_id) BETWEEN 1 AND 63
    AND merchant_order_id ~ '^[A-Za-z0-9_-]+$'
  ),
  provider_order_id text NULL,
  provider_dispatch_started_at timestamptz NULL,
  setup_expires_at timestamptz NOT NULL,
  not_found_first_observed_at timestamptz NULL,
  sdk_order_token_ciphertext bytea NULL,
  sdk_order_token_nonce bytea NULL,
  sdk_order_token_key_version text NULL,
  sdk_order_token_expires_at timestamptz NULL,
  state mandate_setup_state NOT NULL DEFAULT 'created',
  failure_code text NULL CHECK (
    failure_code IS NULL OR (
      length(failure_code) BETWEEN 1 AND 128
      AND failure_code ~ '^[A-Za-z0-9_.:-]+$'
    )
  ),
  last_status_checked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  CONSTRAINT mandate_setup_attempts_mandate_attempt_uk UNIQUE (mandate_id, attempt_number),
  CONSTRAINT mandate_setup_attempts_merchant_order_uk UNIQUE (merchant_order_id),
  CONSTRAINT mandate_setup_attempts_provider_order_uk UNIQUE (provider, provider_order_id),
  CONSTRAINT mandate_setup_attempts_mandate_fk
    FOREIGN KEY (mandate_id, sip_plan_id, user_id)
    REFERENCES payment_mandates (id, sip_plan_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT mandate_setup_attempts_token_envelope_check CHECK (
    (
      state = 'provider_pending'
      AND provider_dispatch_started_at IS NOT NULL
      AND provider_order_id IS NOT NULL
      AND sdk_order_token_ciphertext IS NOT NULL
      AND octet_length(sdk_order_token_ciphertext) >= 16
      AND sdk_order_token_nonce IS NOT NULL
      AND octet_length(sdk_order_token_nonce) = 12
      AND sdk_order_token_key_version IS NOT NULL
      AND btrim(sdk_order_token_key_version) <> ''
      AND sdk_order_token_expires_at IS NOT NULL
      AND sdk_order_token_expires_at > provider_dispatch_started_at
    )
    OR
    (
      state <> 'provider_pending'
      AND sdk_order_token_ciphertext IS NULL
      AND sdk_order_token_nonce IS NULL
      AND sdk_order_token_key_version IS NULL
      AND sdk_order_token_expires_at IS NULL
    )
  ),
  CONSTRAINT mandate_setup_attempts_dispatch_shape CHECK (
    (state = 'created' AND provider_dispatch_started_at IS NULL)
    OR (state = 'expired' AND provider_dispatch_started_at IS NULL)
    OR (state <> 'created' AND provider_dispatch_started_at IS NOT NULL)
  ),
  CONSTRAINT mandate_setup_attempts_failure_shape CHECK (
    state <> 'failed' OR failure_code IS NOT NULL
  ),
  CONSTRAINT mandate_setup_attempts_expiry_shape CHECK (setup_expires_at > created_at)
);

CREATE UNIQUE INDEX mandate_setup_attempts_current_uk
  ON mandate_setup_attempts (mandate_id)
  WHERE state IN ('created', 'dispatching', 'provider_pending');

CREATE INDEX mandate_setup_attempts_reconciliation_idx
  ON mandate_setup_attempts (state, last_status_checked_at, id)
  WHERE state IN ('dispatching', 'provider_pending');

CREATE TABLE mandate_collection_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandate_id uuid NOT NULL,
  sip_plan_id uuid NOT NULL,
  user_id uuid NOT NULL,
  fund_id uuid NOT NULL,
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  due_period date NOT NULL CHECK (due_period = date_trunc('month', due_period)::date),
  scheduled_debit_at timestamptz NOT NULL,
  notify_at timestamptz NOT NULL,
  order_id uuid NOT NULL,
  payment_id uuid NOT NULL,
  payment_attempt_id uuid NOT NULL,
  checkout_channel text NOT NULL DEFAULT 'phonepe_autopay' CHECK (checkout_channel = 'phonepe_autopay'),
  notify_state mandate_notify_state NOT NULL DEFAULT 'created',
  notify_dispatch_started_at timestamptz NULL,
  notified_at timestamptz NULL,
  notify_failure_code text NULL CHECK (
    notify_failure_code IS NULL OR (
      length(notify_failure_code) BETWEEN 1 AND 128
      AND notify_failure_code ~ '^[A-Za-z0-9_.:-]+$'
    )
  ),
  retry_strategy text NOT NULL CHECK (retry_strategy = 'standard'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  CONSTRAINT mandate_collection_attempts_mandate_period_uk UNIQUE (mandate_id, due_period),
  CONSTRAINT mandate_collection_attempts_sip_period_uk UNIQUE (sip_plan_id, due_period),
  CONSTRAINT mandate_collection_attempts_order_uk UNIQUE (order_id),
  CONSTRAINT mandate_collection_attempts_payment_uk UNIQUE (payment_id),
  CONSTRAINT mandate_collection_attempts_payment_attempt_uk UNIQUE (payment_attempt_id),
  CONSTRAINT mandate_collection_attempts_timing_check CHECK (notify_at = scheduled_debit_at - interval '24 hours'),
  CONSTRAINT mandate_collection_attempts_mandate_fk
    FOREIGN KEY (mandate_id, sip_plan_id, user_id, fund_id)
    REFERENCES payment_mandates (id, sip_plan_id, user_id, fund_id) ON DELETE RESTRICT,
  CONSTRAINT mandate_collection_attempts_mandate_amount_fk
    FOREIGN KEY (mandate_id, sip_plan_id, user_id, fund_id, amount_paise)
    REFERENCES payment_mandates (id, sip_plan_id, user_id, fund_id, max_amount_paise) ON DELETE RESTRICT,
  CONSTRAINT mandate_collection_attempts_sip_amount_fk
    FOREIGN KEY (sip_plan_id, user_id, fund_id, amount_paise)
    REFERENCES sip_plans (id, user_id, fund_id, amount_paise) ON DELETE RESTRICT,
  CONSTRAINT mandate_collection_attempts_order_fk
    FOREIGN KEY (order_id, sip_plan_id, user_id, fund_id, due_period)
    REFERENCES investment_orders (id, sip_plan_id, user_id, fund_id, due_period) ON DELETE RESTRICT,
  CONSTRAINT mandate_collection_attempts_order_amount_fk
    FOREIGN KEY (order_id, sip_plan_id, user_id, fund_id, due_period, amount_paise)
    REFERENCES investment_orders (id, sip_plan_id, user_id, fund_id, due_period, amount_paise) ON DELETE RESTRICT,
  CONSTRAINT mandate_collection_attempts_payment_fk
    FOREIGN KEY (payment_id, order_id, user_id)
    REFERENCES payments (id, order_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT mandate_collection_attempts_payment_amount_fk
    FOREIGN KEY (payment_id, order_id, user_id, amount_paise)
    REFERENCES payments (id, order_id, user_id, amount_paise) ON DELETE RESTRICT,
  CONSTRAINT mandate_collection_attempts_payment_attempt_fk
    FOREIGN KEY (payment_attempt_id, payment_id, user_id, checkout_channel)
    REFERENCES payment_attempts (id, payment_id, user_id, checkout_channel) ON DELETE RESTRICT,
  CONSTRAINT mandate_collection_attempts_notify_shape CHECK (
    (notify_state = 'created' AND notify_dispatch_started_at IS NULL AND notified_at IS NULL AND notify_failure_code IS NULL)
    OR (notify_state = 'dispatching' AND notify_dispatch_started_at IS NOT NULL AND notified_at IS NULL AND notify_failure_code IS NULL)
    OR (notify_state = 'notified' AND notify_dispatch_started_at IS NOT NULL AND notified_at IS NOT NULL AND notify_failure_code IS NULL)
    OR (notify_state = 'failed' AND notify_dispatch_started_at IS NOT NULL AND notified_at IS NULL AND notify_failure_code IS NOT NULL)
  )
);

CREATE INDEX mandate_collection_attempts_notify_idx
  ON mandate_collection_attempts (notify_state, notify_dispatch_started_at, id)
  WHERE notify_state IN ('created', 'dispatching', 'failed');

CREATE FUNCTION validate_mandate_collection_attempt() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM sip_plans sip
    JOIN payment_mandates mandate
      ON mandate.id = NEW.mandate_id
      AND mandate.sip_plan_id = sip.id
      AND mandate.user_id = sip.user_id
      AND mandate.fund_id = sip.fund_id
    JOIN investment_orders investment_order
      ON investment_order.id = NEW.order_id
      AND investment_order.sip_plan_id = sip.id
      AND investment_order.user_id = sip.user_id
      AND investment_order.fund_id = sip.fund_id
      AND investment_order.due_period = NEW.due_period
    JOIN payments payment
      ON payment.id = NEW.payment_id
      AND payment.order_id = investment_order.id
      AND payment.user_id = sip.user_id
    JOIN payment_attempts payment_attempt
      ON payment_attempt.id = NEW.payment_attempt_id
      AND payment_attempt.payment_id = payment.id
      AND payment_attempt.user_id = sip.user_id
    WHERE sip.id = NEW.sip_plan_id
      AND sip.user_id = NEW.user_id
      AND sip.fund_id = NEW.fund_id
      AND sip.collection_mode = 'phonepe_autopay'
      AND sip.state = 'active'
      AND mandate.state = 'active'
      AND mandate.provider_subscription_id IS NOT NULL
      AND mandate.amount_type = 'fixed'
      AND investment_order.type = 'sip_installment'
      AND investment_order.state = 'payment_pending'
      AND payment.state = 'created'
      AND payment_attempt.state = 'created'
      AND payment_attempt.checkout_channel = 'phonepe_autopay'
      AND payment_attempt.provider_dispatch_started_at IS NULL
      AND payment_attempt.provider_order_id IS NULL
      AND sip.amount_paise = NEW.amount_paise
      AND mandate.max_amount_paise = NEW.amount_paise
      AND investment_order.amount_paise = NEW.amount_paise
      AND payment.amount_paise = NEW.amount_paise
  ) THEN
    RAISE EXCEPTION 'mandate collection provenance or pre-dispatch state is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER mandate_collection_attempts_validate
  BEFORE INSERT OR UPDATE OF mandate_id, sip_plan_id, user_id, fund_id, amount_paise,
    due_period, order_id, payment_id, payment_attempt_id
  ON mandate_collection_attempts
  FOR EACH ROW EXECUTE FUNCTION validate_mandate_collection_attempt();

CREATE FUNCTION assert_autopay_sip_mandate(target_sip_plan_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  target_mode sip_collection_mode;
  target_state sip_state;
  latest_mandate_state payment_mandate_state;
  latest_mandate_authorized_at timestamptz;
BEGIN
  SELECT collection_mode, state
    INTO target_mode, target_state
    FROM sip_plans
    WHERE id = target_sip_plan_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT state, authorized_at
    INTO latest_mandate_state, latest_mandate_authorized_at
    FROM payment_mandates
    WHERE sip_plan_id = target_sip_plan_id
    ORDER BY created_at DESC, id DESC
    LIMIT 1;

  IF latest_mandate_state IS NOT NULL AND target_mode <> 'phonepe_autopay' THEN
    RAISE EXCEPTION 'mandate requires a phonepe_autopay SIP';
  END IF;

  IF target_mode = 'phonepe_autopay' AND target_state = 'draft'
    AND latest_mandate_state IN ('setup_pending', 'active', 'pause_pending', 'paused', 'cancel_pending', 'revoke_pending') THEN
    RAISE EXCEPTION 'draft phonepe_autopay SIP cannot have a current mandate';
  END IF;

  IF target_mode = 'phonepe_autopay' AND target_state = 'pending_mandate'
    AND latest_mandate_state IS DISTINCT FROM 'setup_pending' THEN
    RAISE EXCEPTION 'pending phonepe_autopay SIP requires a setup_pending mandate';
  END IF;

  IF target_mode = 'phonepe_autopay' AND target_state = 'active'
    AND (latest_mandate_state IS NULL OR latest_mandate_state NOT IN ('active', 'pause_pending')) THEN
    RAISE EXCEPTION 'active phonepe_autopay SIP requires a compatible current mandate';
  END IF;

  IF target_mode = 'phonepe_autopay' AND target_state = 'paused'
    AND latest_mandate_state IS DISTINCT FROM 'paused' THEN
    RAISE EXCEPTION 'paused phonepe_autopay SIP requires a paused mandate';
  END IF;

  IF target_mode = 'phonepe_autopay' AND target_state = 'cancel_pending'
    AND (latest_mandate_state IS NULL OR latest_mandate_state NOT IN ('cancel_pending', 'revoke_pending')) THEN
    RAISE EXCEPTION 'cancel_pending phonepe_autopay SIP requires a cancellation mandate state';
  END IF;

  IF target_mode = 'phonepe_autopay' AND target_state = 'setup_failed'
    AND (latest_mandate_state IS DISTINCT FROM 'failed' OR latest_mandate_authorized_at IS NOT NULL) THEN
    RAISE EXCEPTION 'setup_failed phonepe_autopay SIP requires a pre-authorization failed mandate';
  END IF;

  IF target_mode = 'phonepe_autopay' AND target_state = 'mandate_failed'
    AND (latest_mandate_state IS DISTINCT FROM 'failed' OR latest_mandate_authorized_at IS NULL) THEN
    RAISE EXCEPTION 'mandate_failed phonepe_autopay SIP requires a post-authorization failed mandate';
  END IF;

  IF target_mode = 'phonepe_autopay' AND target_state = 'cancelled'
    AND latest_mandate_state IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'cancelled phonepe_autopay SIP requires a cancelled mandate';
  END IF;

  IF target_mode = 'phonepe_autopay' AND target_state = 'revoked'
    AND latest_mandate_state IS DISTINCT FROM 'revoked' THEN
    RAISE EXCEPTION 'revoked phonepe_autopay SIP requires a revoked mandate';
  END IF;

  IF target_mode = 'phonepe_autopay' AND target_state = 'expired'
    AND latest_mandate_state IS DISTINCT FROM 'expired' THEN
    RAISE EXCEPTION 'expired phonepe_autopay SIP requires an expired mandate';
  END IF;

  IF target_mode = 'phonepe_autopay' AND target_state = 'completed'
    AND (latest_mandate_state IS NULL OR latest_mandate_state NOT IN ('cancelled', 'revoked', 'expired', 'failed')) THEN
    RAISE EXCEPTION 'completed phonepe_autopay SIP requires a terminal mandate';
  END IF;
END;
$$;

CREATE FUNCTION enforce_autopay_sip_mandate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'sip_plans' THEN
    PERFORM assert_autopay_sip_mandate(NEW.id);
  ELSE
    IF TG_OP <> 'INSERT' THEN
      PERFORM assert_autopay_sip_mandate(OLD.sip_plan_id);
    END IF;
    IF TG_OP <> 'DELETE' THEN
      PERFORM assert_autopay_sip_mandate(NEW.sip_plan_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER sip_plans_active_mandate_guard
  AFTER INSERT OR UPDATE ON sip_plans
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_autopay_sip_mandate();

CREATE CONSTRAINT TRIGGER payment_mandates_active_sip_guard
  AFTER INSERT OR UPDATE OR DELETE ON payment_mandates
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_autopay_sip_mandate();

ALTER TABLE payment_attempts
  DROP CONSTRAINT payment_attempts_checkout_channel_check,
  ADD CONSTRAINT payment_attempts_checkout_channel_check
    CHECK (checkout_channel IN ('hosted_redirect', 'phonepe_mobile_sdk', 'phonepe_autopay', 'phonepe_mandate_setup')),
  DROP CONSTRAINT payment_attempts_sdk_dispatch_channel_check,
  ADD CONSTRAINT payment_attempts_sdk_dispatch_channel_check
    CHECK (
      provider_dispatch_started_at IS NULL
      OR checkout_channel IN ('phonepe_mobile_sdk', 'phonepe_mandate_setup', 'phonepe_autopay')
    );

ALTER TABLE mandate_setup_attempts
  ADD COLUMN fund_id uuid NULL,
  ADD COLUMN amount_paise bigint NULL,
  ADD COLUMN due_period date NULL,
  ADD COLUMN order_id uuid NULL,
  ADD COLUMN payment_id uuid NULL,
  ADD COLUMN payment_attempt_id uuid NULL,
  ADD COLUMN checkout_channel text NULL,
  ADD CONSTRAINT mandate_setup_attempts_order_uk UNIQUE (order_id),
  ADD CONSTRAINT mandate_setup_attempts_payment_uk UNIQUE (payment_id),
  ADD CONSTRAINT mandate_setup_attempts_payment_attempt_uk UNIQUE (payment_attempt_id),
  ADD CONSTRAINT mandate_setup_attempts_canonical_shape CHECK (
    (
      fund_id IS NULL
      AND amount_paise IS NULL
      AND due_period IS NULL
      AND order_id IS NULL
      AND payment_id IS NULL
      AND payment_attempt_id IS NULL
      AND checkout_channel IS NULL
    )
    OR
    (
      fund_id IS NOT NULL
      AND amount_paise IS NOT NULL
      AND due_period = date_trunc('month', due_period)::date
      AND order_id IS NOT NULL
      AND payment_id IS NOT NULL
      AND payment_attempt_id IS NOT NULL
      AND checkout_channel = 'phonepe_mandate_setup'
    )
  ),
  ADD CONSTRAINT mandate_setup_attempts_mandate_amount_fk
    FOREIGN KEY (mandate_id, sip_plan_id, user_id, fund_id, amount_paise)
    REFERENCES payment_mandates (id, sip_plan_id, user_id, fund_id, max_amount_paise) ON DELETE RESTRICT,
  ADD CONSTRAINT mandate_setup_attempts_sip_amount_fk
    FOREIGN KEY (sip_plan_id, user_id, fund_id, amount_paise)
    REFERENCES sip_plans (id, user_id, fund_id, amount_paise) ON DELETE RESTRICT,
  ADD CONSTRAINT mandate_setup_attempts_order_amount_fk
    FOREIGN KEY (order_id, sip_plan_id, user_id, fund_id, due_period, amount_paise)
    REFERENCES investment_orders (id, sip_plan_id, user_id, fund_id, due_period, amount_paise) ON DELETE RESTRICT,
  ADD CONSTRAINT mandate_setup_attempts_payment_amount_fk
    FOREIGN KEY (payment_id, order_id, user_id, amount_paise)
    REFERENCES payments (id, order_id, user_id, amount_paise) ON DELETE RESTRICT,
  ADD CONSTRAINT mandate_setup_attempts_payment_attempt_fk
    FOREIGN KEY (payment_attempt_id, payment_id, user_id, checkout_channel)
    REFERENCES payment_attempts (id, payment_id, user_id, checkout_channel) ON DELETE RESTRICT;

CREATE FUNCTION validate_mandate_setup_canonical_payment() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.payment_attempt_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM sip_plans sip
    JOIN payment_mandates mandate
      ON mandate.id = NEW.mandate_id
      AND mandate.sip_plan_id = sip.id
      AND mandate.user_id = sip.user_id
      AND mandate.fund_id = sip.fund_id
    JOIN investment_orders investment_order
      ON investment_order.id = NEW.order_id
      AND investment_order.sip_plan_id = sip.id
      AND investment_order.user_id = sip.user_id
      AND investment_order.fund_id = sip.fund_id
      AND investment_order.due_period = NEW.due_period
    JOIN payments payment
      ON payment.id = NEW.payment_id
      AND payment.order_id = investment_order.id
      AND payment.user_id = sip.user_id
    JOIN payment_attempts payment_attempt
      ON payment_attempt.id = NEW.payment_attempt_id
      AND payment_attempt.payment_id = payment.id
      AND payment_attempt.user_id = sip.user_id
    WHERE sip.id = NEW.sip_plan_id
      AND sip.collection_mode = 'phonepe_autopay'
      AND sip.state = 'pending_mandate'
      AND mandate.state = 'setup_pending'
      AND investment_order.type = 'sip_installment'
      AND investment_order.state = 'payment_pending'
      AND payment.state = 'created'
      AND payment_attempt.state = 'created'
      AND payment_attempt.checkout_channel = 'phonepe_mandate_setup'
      AND payment_attempt.provider_dispatch_started_at IS NULL
      AND payment_attempt.provider_order_id IS NULL
      AND payment_attempt.merchant_order_id = NEW.merchant_order_id
      AND sip.amount_paise = NEW.amount_paise
      AND mandate.max_amount_paise = NEW.amount_paise
      AND investment_order.amount_paise = NEW.amount_paise
      AND payment.amount_paise = NEW.amount_paise
  ) THEN
    RAISE EXCEPTION 'mandate setup canonical payment provenance is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER mandate_setup_attempts_canonical_payment_validate
  BEFORE INSERT OR UPDATE OF mandate_id, sip_plan_id, user_id, fund_id, amount_paise,
    due_period, order_id, payment_id, payment_attempt_id, checkout_channel, merchant_order_id
  ON mandate_setup_attempts
  FOR EACH ROW EXECUTE FUNCTION validate_mandate_setup_canonical_payment();

ALTER TABLE mandate_setup_attempts
  DROP CONSTRAINT mandate_setup_attempts_order_uk,
  DROP CONSTRAINT mandate_setup_attempts_payment_uk;

CREATE TYPE mandate_cancel_command_state AS ENUM ('queued', 'dispatching', 'accepted', 'rejected', 'reconciliation_required');

ALTER TABLE sip_plans
  ADD CONSTRAINT sip_plans_autopay_duration_check CHECK (
    collection_mode <> 'phonepe_autopay'
    OR (duration_months IS NOT NULL AND duration_months BETWEEN 1 AND 360)
  );

ALTER TABLE payment_mandates
  ADD COLUMN abandonment_requested_at timestamptz NULL;

CREATE TABLE mandate_cancel_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandate_id uuid NOT NULL,
  sip_plan_id uuid NOT NULL,
  user_id uuid NOT NULL,
  merchant_subscription_id text NOT NULL,
  previous_mandate_state payment_mandate_state NOT NULL CHECK (
    previous_mandate_state IN ('setup_pending', 'active', 'paused')
  ),
  state mandate_cancel_command_state NOT NULL DEFAULT 'queued',
  attempt_number integer NOT NULL DEFAULT 1 CHECK (attempt_number = 1),
  dispatch_started_at timestamptz NULL,
  status_check_count integer NOT NULL DEFAULT 0 CHECK (status_check_count >= 0),
  last_status_checked_at timestamptz NULL,
  reconciliation_required_at timestamptz NULL,
  accepted_at timestamptz NULL,
  rejected_at timestamptz NULL,
  failure_code text NULL CHECK (
    failure_code IS NULL OR (
      length(failure_code) BETWEEN 1 AND 128
      AND failure_code ~ '^[A-Za-z0-9_.:-]+$'
    )
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  CONSTRAINT mandate_cancel_commands_mandate_uk UNIQUE (mandate_id),
  CONSTRAINT mandate_cancel_commands_subscription_uk UNIQUE (merchant_subscription_id),
  CONSTRAINT mandate_cancel_commands_mandate_fk
    FOREIGN KEY (mandate_id, sip_plan_id, user_id)
    REFERENCES payment_mandates (id, sip_plan_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT mandate_cancel_commands_shape CHECK (
    (state = 'queued' AND dispatch_started_at IS NULL AND status_check_count = 0 AND last_status_checked_at IS NULL AND reconciliation_required_at IS NULL AND accepted_at IS NULL AND rejected_at IS NULL AND failure_code IS NULL)
    OR (state = 'dispatching' AND dispatch_started_at IS NOT NULL AND reconciliation_required_at IS NULL AND accepted_at IS NULL AND rejected_at IS NULL AND failure_code IS NULL)
    OR (state = 'reconciliation_required' AND dispatch_started_at IS NOT NULL AND status_check_count >= 2 AND last_status_checked_at IS NOT NULL AND reconciliation_required_at IS NOT NULL AND accepted_at IS NULL AND rejected_at IS NULL AND failure_code IS NOT NULL)
    OR (state = 'accepted' AND dispatch_started_at IS NOT NULL AND accepted_at IS NOT NULL AND rejected_at IS NULL)
    OR (state = 'rejected' AND dispatch_started_at IS NOT NULL AND accepted_at IS NULL AND rejected_at IS NOT NULL AND failure_code IS NOT NULL)
  )
);

CREATE INDEX mandate_cancel_commands_dispatch_idx
  ON mandate_cancel_commands (state, updated_at, id)
  WHERE state IN ('queued', 'dispatching', 'reconciliation_required');

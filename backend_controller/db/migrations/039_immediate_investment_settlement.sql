ALTER TABLE investment_allocations
  ADD COLUMN actor_type ledger_actor_type NOT NULL DEFAULT 'admin';

ALTER TABLE investment_allocations
  ALTER COLUMN allocated_by_user_id DROP NOT NULL;

ALTER TABLE investment_allocations
  ADD CONSTRAINT investment_allocations_actor_shape CHECK (
    (actor_type = 'admin' AND allocated_by_user_id IS NOT NULL)
    OR (actor_type = 'system' AND allocated_by_user_id IS NULL)
  );

ALTER TABLE investment_reviews RENAME TO legacy_investment_reviews;
ALTER TYPE review_state RENAME TO legacy_review_state;

CREATE TYPE fund_receipt_acknowledgement_state AS ENUM ('pending', 'acknowledged');

CREATE TABLE fund_receipt_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES investment_orders(id) ON DELETE RESTRICT,
  state fund_receipt_acknowledgement_state NOT NULL DEFAULT 'pending',
  acknowledged_by_user_id uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  private_note text NULL,
  acknowledged_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT fund_receipt_acknowledgements_order_uk UNIQUE (order_id),
  CONSTRAINT fund_receipt_acknowledgements_state_shape CHECK (
    (state = 'pending' AND acknowledged_by_user_id IS NULL AND acknowledged_at IS NULL)
    OR (state = 'acknowledged' AND acknowledged_by_user_id IS NOT NULL AND acknowledged_at IS NOT NULL)
  )
);

CREATE INDEX fund_receipt_acknowledgements_queue_idx
  ON fund_receipt_acknowledgements (state, created_at, id);

CREATE UNIQUE INDEX notifications_fund_acknowledgement_uk
  ON notifications (user_id, kind, (payload ->> 'orderId'))
  WHERE kind = 'fund_receipt_acknowledged';

INSERT INTO fund_receipt_acknowledgements (order_id)
SELECT investment_order.id
FROM investment_orders investment_order
JOIN payments payment ON payment.order_id = investment_order.id
JOIN investment_allocations allocation ON allocation.order_id = investment_order.id
JOIN client_value_entries entry
  ON entry.order_id = investment_order.id
 AND entry.payment_id = payment.id
 AND entry.allocation_id = allocation.id
WHERE investment_order.state = 'accepted'
  AND payment.state = 'succeeded'
  AND allocation.amount_paise = payment.amount_paise
  AND entry.entry_type = 'contribution'
  AND entry.principal_delta_paise = payment.amount_paise
  AND entry.value_delta_paise = payment.amount_paise
ON CONFLICT (order_id) DO NOTHING;

INSERT INTO audit_events (
  actor_type,
  command,
  entity_type,
  entity_id,
  from_state,
  to_state,
  request_id,
  entity_version,
  metadata
)
SELECT
  'system',
  'investment_payment.settlement_migrated',
  'investment_order',
  investment_order.id,
  NULL,
  'accepted',
  payment.id,
  investment_order.version,
  jsonb_build_object(
    'paymentId', payment.id,
    'userId', investment_order.user_id,
    'fundId', investment_order.fund_id,
    'amountPaise', payment.amount_paise::text
  )
FROM investment_orders investment_order
JOIN payments payment ON payment.order_id = investment_order.id
JOIN investment_allocations allocation ON allocation.order_id = investment_order.id
JOIN client_value_entries entry
  ON entry.order_id = investment_order.id
 AND entry.payment_id = payment.id
 AND entry.allocation_id = allocation.id
JOIN fund_receipt_acknowledgements acknowledgement ON acknowledgement.order_id = investment_order.id
WHERE investment_order.state = 'accepted'
  AND payment.state = 'succeeded'
  AND entry.entry_type = 'contribution'
  AND NOT EXISTS (
    SELECT 1
    FROM audit_events audit
    WHERE audit.command IN ('investment_payment.settle', 'investment_payment.settlement_migrated')
      AND audit.entity_id = investment_order.id
      AND audit.request_id = payment.id
  );

UPDATE payment_attempts attempt
SET state = 'reconciliation_required',
    reconciliation_required_at = now(),
    next_status_check_at = NULL,
    reconciliation_lease_expires_at = NULL,
    updated_at = now(),
    version = attempt.version + 1
FROM payments payment, investment_orders investment_order
WHERE attempt.payment_id = payment.id
  AND payment.order_id = investment_order.id
  AND attempt.state = 'succeeded'
  AND payment.state = 'succeeded'
  AND investment_order.state = 'review_pending'
  AND attempt.checkout_channel NOT IN ('hosted_redirect', 'phonepe_mobile_sdk');

UPDATE payments payment
SET state = 'reconciliation_required',
    updated_at = now(),
    version = payment.version + 1
FROM investment_orders investment_order
WHERE payment.order_id = investment_order.id
  AND payment.state = 'succeeded'
  AND investment_order.state = 'review_pending'
  AND EXISTS (
    SELECT 1
    FROM payment_attempts attempt
    WHERE attempt.payment_id = payment.id
      AND attempt.state = 'reconciliation_required'
  );

UPDATE payment_attempts attempt
SET state = 'provider_pending',
    failure_code = NULL,
    next_status_check_at = now(),
    reconciliation_lease_expires_at = NULL,
    reconciliation_failure_count = 0,
    reconciliation_required_at = NULL,
    updated_at = now(),
    version = attempt.version + 1
FROM payments payment, investment_orders investment_order
WHERE attempt.payment_id = payment.id
  AND payment.order_id = investment_order.id
  AND attempt.state = 'succeeded'
  AND payment.state = 'succeeded'
  AND investment_order.state = 'review_pending'
  AND attempt.checkout_channel IN ('hosted_redirect', 'phonepe_mobile_sdk');

UPDATE payments payment
SET state = 'provider_pending',
    updated_at = now(),
    version = payment.version + 1
FROM investment_orders investment_order
WHERE payment.order_id = investment_order.id
  AND payment.state = 'succeeded'
  AND investment_order.state = 'review_pending'
  AND EXISTS (
    SELECT 1
    FROM payment_attempts attempt
    WHERE attempt.payment_id = payment.id
      AND attempt.state = 'provider_pending'
  );

UPDATE investment_orders
SET state = 'payment_pending',
    updated_at = now(),
    version = version + 1
WHERE state = 'review_pending';

UPDATE permissions
SET code = 'funds.receipts.read', description = 'Read received fund acknowledgements'
WHERE code = 'investments.review.read';

UPDATE permissions
SET code = 'funds.receipts.write', description = 'Acknowledge received client funds'
WHERE code = 'investments.review.write';

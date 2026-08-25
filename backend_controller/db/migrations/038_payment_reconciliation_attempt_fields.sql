ALTER TABLE payment_attempts
  DROP CONSTRAINT payment_attempts_state,
  ADD COLUMN next_status_check_at timestamptz NULL,
  ADD COLUMN reconciliation_lease_expires_at timestamptz NULL,
  ADD COLUMN reconciliation_failure_count integer NOT NULL DEFAULT 0 CHECK (reconciliation_failure_count >= 0),
  ADD COLUMN reconciliation_required_at timestamptz NULL;

ALTER TABLE payment_attempts
  ADD CONSTRAINT payment_attempts_state
    CHECK (state IN ('created', 'provider_pending', 'succeeded', 'failed', 'expired', 'reconciliation_required')),
  ADD CONSTRAINT payment_attempts_reconciliation_required_at_check
    CHECK ((state = 'reconciliation_required') = (reconciliation_required_at IS NOT NULL));

CREATE INDEX payment_attempts_reconciliation_due_idx
  ON payment_attempts (next_status_check_at, created_at, id)
  WHERE state IN ('created', 'provider_pending');

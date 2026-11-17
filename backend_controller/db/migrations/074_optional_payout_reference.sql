ALTER TABLE withdrawal_operations DROP CONSTRAINT withdrawal_operations_shape;

ALTER TABLE withdrawal_operations ADD CONSTRAINT withdrawal_operations_shape CHECK (
  (state = 'pending' AND paid_at IS NULL AND failed_at IS NULL AND failure_code IS NULL AND transfer_reference IS NULL)
  OR (state = 'paid' AND paid_at IS NOT NULL AND failed_at IS NULL AND failure_code IS NULL
    AND (transfer_reference IS NULL OR btrim(transfer_reference) <> ''))
  OR (state = 'failed' AND failed_at IS NOT NULL AND failure_code IS NOT NULL AND paid_at IS NULL AND transfer_reference IS NULL)
);

ALTER TABLE aum_growth_batches
  DROP CONSTRAINT IF EXISTS aum_growth_batches_idempotency_uk;

ALTER TABLE aum_growth_batches
  DROP COLUMN IF EXISTS idempotency_record_id;

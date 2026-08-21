ALTER TABLE funds DROP CONSTRAINT IF EXISTS funds_published_ts;

ALTER TABLE funds ALTER COLUMN state DROP DEFAULT;

ALTER TYPE fund_state RENAME TO fund_state_legacy;

CREATE TYPE fund_state AS ENUM ('draft', 'published', 'paused', 'archived');

ALTER TABLE funds
  ALTER COLUMN state TYPE fund_state USING state::text::fund_state;

ALTER TABLE funds ALTER COLUMN state SET DEFAULT 'draft';

DROP TYPE fund_state_legacy;

ALTER TABLE funds
  ADD CONSTRAINT funds_published_ts CHECK (state = 'draft' OR published_at IS NOT NULL);

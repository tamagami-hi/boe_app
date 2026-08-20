-- AD-001 (admin surface slice): additive presentation fields for the admin-managed
-- catalog/content domains (spec 03 §4.2/§4.5).
--
-- The canonical tables model the *governed* attributes (identity, money, state,
-- versioning). The admin console additionally manages presentation attributes
-- for the marketing/landing surfaces (a course's level/format/outcome and sort
-- order, a plan's tagline/features/CTA/highlight). Those are non-policy display
-- data, so they live in a constrained `payload` jsonb per row rather than in new
-- typed columns per field. Monetary thresholds and policy still never live in
-- JSON (they stay in finance_policy_versions).
--
-- `courses.duration_minutes` is relaxed to NULL-able: a course can be drafted
-- before its runtime is known, and the admin editor does not collect it.
--
-- `fund_versions.return_tier` records the expected-return band shown next to
-- `risk_level` on the client fund cards (session-2 modelling decision B).
-- Append-only published versions keep it immutable per version.

ALTER TABLE courses
  ADD COLUMN payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ALTER COLUMN duration_minutes DROP NOT NULL;

ALTER TABLE courses
  ADD CONSTRAINT courses_payload_object CHECK (jsonb_typeof(payload) = 'object');

ALTER TABLE membership_plans
  ADD COLUMN payload jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE membership_plans
  ADD CONSTRAINT membership_plans_payload_object CHECK (jsonb_typeof(payload) = 'object');

DO $$ BEGIN
  CREATE TYPE fund_return_tier AS ENUM ('low', 'moderate', 'high');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE fund_versions
  ADD COLUMN return_tier fund_return_tier NULL;

-- Keyset indexes for the admin list surfaces (created_at DESC, id DESC).
CREATE INDEX IF NOT EXISTS courses_admin_queue_idx ON courses (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS membership_plans_admin_queue_idx ON membership_plans (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS content_items_admin_queue_idx ON content_items (kind, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS funds_admin_queue_idx ON funds (created_at DESC, id DESC);
-- `audit_events` is append-only and timestamped by `occurred_at` (it has no
-- `created_at`), so its keyset index follows that column.
CREATE INDEX IF NOT EXISTS audit_events_admin_queue_idx ON audit_events (occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS users_admin_queue_idx ON users (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS kyc_cases_admin_queue_idx ON kyc_cases (state, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS investment_orders_admin_queue_idx
  ON investment_orders (state, created_at DESC, id DESC);

-- 005_json_collections_parity.sql
-- Adds Postgres tables for JSON-store collections not covered by 001-004.
-- All free-form structures stored as jsonb. FKs to users(id) where applicable.
-- Idempotency keys are UNIQUE so INSERT ... ON CONFLICT (idempotency_key) DO NOTHING works.

-- ---------- funds ----------
CREATE TABLE IF NOT EXISTS funds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  lifecycle_stage text NOT NULL DEFAULT 'draft',
  currency text NOT NULL DEFAULT 'INR',
  min_sip numeric(18, 2),
  min_lumpsum numeric(18, 2),
  aum_cash numeric(20, 2) NOT NULL DEFAULT 0,
  aum_allocated numeric(20, 2) NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS funds_lifecycle_stage_idx ON funds (lifecycle_stage);
CREATE INDEX IF NOT EXISTS funds_created_at_idx ON funds (created_at DESC);

-- ---------- capital_transactions ----------
CREATE TABLE IF NOT EXISTS capital_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id uuid NOT NULL REFERENCES funds (id) ON DELETE CASCADE,
  type text NOT NULL,
  amount numeric(20, 2) NOT NULL,
  linked_entity_type text,
  linked_entity_id uuid,
  reason text,
  actor_admin_id uuid REFERENCES users (id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS capital_transactions_fund_id_idx ON capital_transactions (fund_id, created_at DESC);
CREATE INDEX IF NOT EXISTS capital_transactions_type_idx ON capital_transactions (type);

-- ---------- redemption_requests ----------
CREATE TABLE IF NOT EXISTS redemption_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  fund_id uuid REFERENCES funds (id) ON DELETE SET NULL,
  preview_id uuid,
  amount numeric(20, 2) NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  requires_dual_approval boolean NOT NULL DEFAULT false,
  dual_approval_threshold_config_version text,
  approvals jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS redemption_requests_user_status_created_idx
  ON redemption_requests (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS redemption_requests_fund_id_idx ON redemption_requests (fund_id);

-- ---------- withdrawal_previews ----------
CREATE TABLE IF NOT EXISTS withdrawal_previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  holding_id text,
  amount numeric(20, 2) NOT NULL,
  assumptions jsonb NOT NULL DEFAULT '{}'::jsonb,
  tax_config_version text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);
CREATE INDEX IF NOT EXISTS withdrawal_previews_user_id_idx
  ON withdrawal_previews (user_id, created_at DESC);

-- ---------- sip_control_requests ----------
CREATE TABLE IF NOT EXISTS sip_control_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  plan_id uuid REFERENCES investment_plans (id) ON DELETE SET NULL,
  action text NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'pending',
  confirmed boolean NOT NULL DEFAULT false,
  reviewed_admin_id uuid REFERENCES users (id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sip_control_requests_user_status_created_idx
  ON sip_control_requests (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS sip_control_requests_plan_id_idx ON sip_control_requests (plan_id);

-- ---------- support_tickets ----------
CREATE TABLE IF NOT EXISTS support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  subject text NOT NULL,
  category text,
  status text NOT NULL DEFAULT 'open',
  priority text,
  assigned_admin_id uuid REFERENCES users (id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_tickets_user_status_created_idx
  ON support_tickets (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_status_idx ON support_tickets (status);

-- ---------- support_ticket_messages ----------
CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES support_tickets (id) ON DELETE CASCADE,
  author_id uuid REFERENCES users (id) ON DELETE SET NULL,
  author_role text NOT NULL,
  body text NOT NULL,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_ticket_messages_ticket_id_idx
  ON support_ticket_messages (ticket_id, created_at);

-- ---------- receipts ----------
CREATE TABLE IF NOT EXISTS receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  actor jsonb NOT NULL DEFAULT '{}'::jsonb,
  subject_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  entity_type text,
  entity_id uuid,
  before_state jsonb,
  after_state jsonb,
  amount numeric(20, 2),
  currency text,
  as_of_timestamp timestamptz,
  source text,
  consent_or_disclosure_snapshot_ref text,
  tax_regime_version text,
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS receipts_subject_user_id_created_idx
  ON receipts (subject_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS receipts_entity_idx ON receipts (entity_type, entity_id);

-- ---------- timeline_events ----------
CREATE TABLE IF NOT EXISTS timeline_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS timeline_events_user_occurred_idx
  ON timeline_events (user_id, occurred_at DESC);

-- ---------- notifications ----------
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text,
  body text,
  status text NOT NULL DEFAULT 'unread',
  read_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_status_created_idx
  ON notifications (user_id, status, created_at DESC);

-- ---------- orders (legacy alias for ingested lumpsum orders) ----------
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  product_id uuid REFERENCES products (id) ON DELETE SET NULL,
  investment_plan_id uuid REFERENCES investment_plans (id) ON DELETE SET NULL,
  type text NOT NULL,
  amount numeric(20, 2),
  status text NOT NULL DEFAULT 'pending',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_user_status_created_idx
  ON orders (user_id, status, created_at DESC);

-- ---------- faqs ----------
CREATE TABLE IF NOT EXISTS faqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question text NOT NULL,
  answer text NOT NULL,
  category text,
  display_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS faqs_active_order_idx ON faqs (active, display_order);

-- ---------- disclosures ----------
CREATE TABLE IF NOT EXISTS disclosures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  title text NOT NULL,
  body text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS disclosures_slug_uidx ON disclosures (slug);

-- ---------- static_pages ----------
CREATE TABLE IF NOT EXISTS static_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  title text NOT NULL,
  body text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS static_pages_slug_uidx ON static_pages (slug);

-- ---------- portfolio_snapshots ----------
-- One row per (user, as_of_date) keyed snapshot replacing the per-user `portfolio_<uuid>` keys in dev-db.json.
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  as_of_date date NOT NULL,
  total_value numeric(20, 2),
  invested_value numeric(20, 2),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS portfolio_snapshots_user_asof_uidx
  ON portfolio_snapshots (user_id, as_of_date);
CREATE INDEX IF NOT EXISTS portfolio_snapshots_user_id_idx ON portfolio_snapshots (user_id);

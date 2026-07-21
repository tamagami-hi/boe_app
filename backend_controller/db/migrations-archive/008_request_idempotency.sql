-- 008_request_idempotency.sql
-- Adds a table for idempotency-key persistence, replacing the JSON-store collection.

CREATE TABLE IF NOT EXISTS request_idempotency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  route text NOT NULL,
  user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  request_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

CREATE INDEX IF NOT EXISTS request_idempotency_key_idx ON request_idempotency (key);
CREATE INDEX IF NOT EXISTS request_idempotency_expires_at_idx ON request_idempotency (expires_at);

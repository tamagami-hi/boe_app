CREATE TABLE worker_heartbeats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_name text NOT NULL CHECK (length(worker_name) BETWEEN 1 AND 64),
  pass_started_at timestamptz NOT NULL,
  pass_completed_at timestamptz NOT NULL,
  success boolean NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text NULL CHECK (
    error_code IS NULL OR (
      length(error_code) BETWEEN 1 AND 64
      AND error_code ~ '^[A-Za-z0-9_.:-]+$'
    )
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0)
);

CREATE UNIQUE INDEX worker_heartbeats_worker_latest_idx
  ON worker_heartbeats (worker_name, pass_completed_at DESC, id DESC);

CREATE INDEX worker_heartbeats_completed_at_idx
  ON worker_heartbeats (pass_completed_at DESC);

ALTER TABLE outbox_events
  ADD COLUMN lease_generation integer NOT NULL DEFAULT 0;
CREATE TABLE email_send_attempts (
  outbox_event_id uuid NOT NULL REFERENCES outbox_events(id) ON DELETE RESTRICT,
  generation integer NOT NULL,
  worker_id text NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NULL,
  outcome text NULL,
  error_code text NULL,
  message_id text NULL,
  PRIMARY KEY (outbox_event_id, generation),
  CONSTRAINT email_send_attempts_generation CHECK (generation >= 1),
  CONSTRAINT email_send_attempts_worker CHECK (btrim(worker_id) <> ''),
  CONSTRAINT email_send_attempts_outcome CHECK (
    outcome IS NULL OR outcome IN ('accepted', 'retryable', 'permanent', 'unknown')
  ),
  CONSTRAINT email_send_attempts_finish_pair CHECK ((outcome IS NULL) = (finished_at IS NULL)),
  CONSTRAINT email_send_attempts_message_id_len CHECK (message_id IS NULL OR char_length(message_id) <= 512)
);

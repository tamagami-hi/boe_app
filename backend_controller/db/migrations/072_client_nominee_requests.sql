CREATE TABLE client_nominee_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  nominee_name text NOT NULL,
  nominee_relation text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  decline_reason text NULL,
  decided_by_user_id uuid NULL REFERENCES users (id) ON DELETE RESTRICT,
  decided_at timestamptz NULL,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_nominee_requests_state CHECK (state IN ('pending', 'accepted', 'declined', 'withdrawn')),
  CONSTRAINT client_nominee_requests_version_positive CHECK (version >= 1),
  CONSTRAINT client_nominee_requests_name_valid CHECK (
    nominee_name = btrim(nominee_name)
    AND char_length(nominee_name) BETWEEN 2 AND 120
    AND nominee_name !~ '[\u0001-\u001f\u007f-\u009f]'
    AND nominee_name !~ '[\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b\u200e\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]'
    AND nominee_name !~ '^[\u200c\u200d]|[\u200c\u200d]$'
  ),
  CONSTRAINT client_nominee_requests_relation_valid CHECK (
    nominee_relation = btrim(nominee_relation)
    AND char_length(nominee_relation) BETWEEN 2 AND 120
    AND nominee_relation !~ '[\u0001-\u001f\u007f-\u009f]'
    AND nominee_relation !~ '[\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b\u200e\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]'
    AND nominee_relation !~ '^[\u200c\u200d]|[\u200c\u200d]$'
  ),
  CONSTRAINT client_nominee_requests_decline_reason_valid CHECK (
    decline_reason IS NULL OR (
      decline_reason = btrim(decline_reason)
      AND char_length(decline_reason) BETWEEN 1 AND 500
      AND decline_reason !~ '[\u0001-\u001f\u007f-\u009f]'
      AND decline_reason !~ '[\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b\u200e\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]'
      AND decline_reason !~ '^[\u200c\u200d]|[\u200c\u200d]$'
    )
  ),
  CONSTRAINT client_nominee_requests_decision_shape CHECK (
    (state = 'pending' AND decided_at IS NULL AND decided_by_user_id IS NULL AND decline_reason IS NULL)
    OR (state = 'withdrawn' AND decided_at IS NOT NULL AND decided_by_user_id IS NULL AND decline_reason IS NULL)
    OR (state = 'accepted' AND decided_at IS NOT NULL AND decided_by_user_id IS NOT NULL AND decline_reason IS NULL)
    OR (state = 'declined' AND decided_at IS NOT NULL AND decided_by_user_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX client_nominee_requests_one_pending_uk
  ON client_nominee_requests (user_id)
  WHERE state = 'pending';

CREATE INDEX client_nominee_requests_user_idx
  ON client_nominee_requests (user_id, created_at DESC, id DESC);

CREATE INDEX client_nominee_requests_queue_idx
  ON client_nominee_requests (created_at DESC, id DESC);

CREATE FUNCTION client_nominee_requests_clear_tombstoned_text() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.user_id AND u.pii_tombstoned_at IS NOT NULL) THEN
    NEW.nominee_name := 'Tombstoned';
    NEW.nominee_relation := 'Tombstoned';
    NEW.decline_reason := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER client_nominee_requests_tombstone_clears_text
  BEFORE INSERT OR UPDATE ON client_nominee_requests
  FOR EACH ROW
  WHEN (NEW.nominee_name <> 'Tombstoned' OR NEW.nominee_relation <> 'Tombstoned' OR NEW.decline_reason IS NOT NULL)
  EXECUTE FUNCTION client_nominee_requests_clear_tombstoned_text();

CREATE FUNCTION users_tombstone_close_nominee_requests() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE client_nominee_requests
     SET nominee_name = 'Tombstoned',
         nominee_relation = 'Tombstoned',
         decline_reason = NULL,
         state = CASE WHEN state = 'pending' THEN 'withdrawn' ELSE state END,
         decided_at = CASE WHEN state = 'pending' THEN now() ELSE decided_at END,
         version = version + 1,
         updated_at = now()
   WHERE user_id = NEW.id
     AND (state = 'pending' OR nominee_name <> 'Tombstoned' OR nominee_relation <> 'Tombstoned' OR decline_reason IS NOT NULL);
  RETURN NULL;
END;
$$;

CREATE TRIGGER users_tombstone_closes_nominee_requests
  AFTER UPDATE OF pii_tombstoned_at ON users
  FOR EACH ROW
  WHEN (NEW.pii_tombstoned_at IS NOT NULL)
  EXECUTE FUNCTION users_tombstone_close_nominee_requests();

ALTER TABLE email_deliveries
  DROP CONSTRAINT email_deliveries_template_check,
  ADD CONSTRAINT email_deliveries_template_check CHECK (
    template_key IN (
      'application_rejected',
      'account_approved',
      'password_set_link',
      'password_reset_link',
      'password_app_download',
      'contact_phone_changed',
      'email_change_code',
      'contact_email_changed',
      'admin_message',
      'app_update_notice',
      'investment_recorded',
      'maturity_options',
      'nominee_request_decided'
    )
  );

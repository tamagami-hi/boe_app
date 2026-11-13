CREATE OR REPLACE FUNCTION user_contact_history_refuse_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  erasing_user text := current_setting('boe.erasing_user_id', true);
  erased_email text;
  kept_columns text[] := ARRAY[
    'previous_email_normalized', 'previous_phone_e164', 'new_email_normalized', 'new_phone_e164', 'reason_detail'
  ];
BEGIN
  IF TG_LEVEL = 'ROW' THEN
    IF erasing_user IS NOT NULL AND erasing_user = OLD.user_id::text THEN
      IF TG_OP = 'DELETE'
         AND NOT EXISTS (
           SELECT 1 FROM users u
           WHERE u.id = OLD.user_id
             AND (u.email_verification_state = 'verified' OR u.email_verified_at IS NOT NULL)
         )
         AND NOT EXISTS (
           SELECT 1 FROM audit_events a
           WHERE a.entity_type = 'user' AND a.entity_id = OLD.user_id AND a.command = 'email_verification.completed'
         )
         AND NOT EXISTS (SELECT 1 FROM client_value_entries e WHERE e.user_id = OLD.user_id) THEN
        RETURN OLD;
      END IF;
      IF TG_OP = 'UPDATE' THEN
        erased_email := 'tombstone+' || replace(OLD.user_id::text, '-', '') || '@invalid.example';
        IF EXISTS (SELECT 1 FROM users u WHERE u.id = OLD.user_id AND u.pii_tombstoned_at IS NOT NULL)
           AND NEW.previous_email_normalized = erased_email
           AND NEW.new_email_normalized = erased_email
           AND NEW.previous_phone_e164 = 'tombstone-previous'
           AND NEW.new_phone_e164 = 'tombstone-new'
           AND (NEW.reason_detail IS NULL OR NEW.reason_detail = OLD.reason_detail)
           AND (to_jsonb(NEW) - kept_columns) = (to_jsonb(OLD) - kept_columns) THEN
          RETURN NEW;
        END IF;
      END IF;
    END IF;
  END IF;
  RAISE EXCEPTION 'user_contact_history is append-only';
END;
$$;

CREATE INDEX email_provider_events_delivery_idx ON email_provider_events (email_delivery_id)
  WHERE email_delivery_id IS NOT NULL;

CREATE INDEX outbox_events_aggregate_idx ON outbox_events (aggregate_id);

CREATE INDEX auth_login_events_unlinked_email_idx ON auth_login_events (email_normalized)
  WHERE user_id IS NULL;

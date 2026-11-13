CREATE SEQUENCE user_contact_release_number_seq AS bigint MINVALUE 1 MAXVALUE 99999999999 NO CYCLE;

CREATE TABLE user_contact_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  change_kind text NOT NULL,
  previous_email_normalized text NOT NULL,
  previous_phone_e164 text NOT NULL,
  new_email_normalized text NOT NULL,
  new_phone_e164 text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  reason_code text NULL,
  reason_detail text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_contact_history_kind CHECK (change_kind IN ('admin_correction', 'closed_release')),
  CONSTRAINT user_contact_history_changed CHECK (
    previous_email_normalized <> new_email_normalized OR previous_phone_e164 <> new_phone_e164
  ),
  CONSTRAINT user_contact_history_reason_code CHECK (
    reason_code IS NULL OR char_length(btrim(reason_code)) BETWEEN 1 AND 80
  ),
  CONSTRAINT user_contact_history_reason_detail CHECK (
    reason_detail IS NULL OR char_length(btrim(reason_detail)) BETWEEN 1 AND 2000
  )
);

CREATE INDEX user_contact_history_user_idx ON user_contact_history (user_id, created_at DESC, id DESC);

CREATE UNIQUE INDEX user_contact_history_release_uk ON user_contact_history (user_id)
  WHERE change_kind = 'closed_release';

CREATE FUNCTION user_contact_history_refuse_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'user_contact_history is append-only';
END;
$$;

CREATE TRIGGER user_contact_history_append_only
  BEFORE UPDATE OR DELETE ON user_contact_history
  FOR EACH ROW EXECUTE FUNCTION user_contact_history_refuse_change();

CREATE TRIGGER user_contact_history_no_truncate
  BEFORE TRUNCATE ON user_contact_history
  FOR EACH STATEMENT EXECUTE FUNCTION user_contact_history_refuse_change();

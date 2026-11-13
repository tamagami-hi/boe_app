ALTER TABLE client_maturity_schedules
  DROP CONSTRAINT client_maturity_schedules_resolution,
  ADD CONSTRAINT client_maturity_schedules_resolution CHECK (
    resolution IS NULL OR resolution IN ('return_all', 'one_time_and_sip', 'sip_reinvestment', 'sip_extension')
  ),
  DROP CONSTRAINT client_maturity_schedules_resolution_links,
  ADD CONSTRAINT client_maturity_schedules_resolution_links CHECK (
    resolution IS NULL
    OR (resolution = 'return_all' AND maturity_id IS NOT NULL AND follow_up_sip_schedule_id IS NULL)
    OR (resolution = 'one_time_and_sip' AND follow_up_sip_schedule_id IS NOT NULL)
    OR (resolution = 'sip_reinvestment' AND maturity_id IS NULL AND follow_up_sip_schedule_id IS NOT NULL)
    OR (resolution = 'sip_extension' AND maturity_id IS NULL AND follow_up_sip_schedule_id IS NOT NULL)
  );

CREATE TABLE client_maturity_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  maturity_schedule_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  fund_id uuid NOT NULL REFERENCES funds (id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'open',
  sip_monthly_amount_paise bigint NOT NULL,
  sip_start_month date NOT NULL,
  sip_month_count integer NOT NULL,
  extension_months integer NULL,
  next_maturity_date date NULL,
  chosen_option text NULL,
  chosen_at timestamptz NULL,
  created_by_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  closed_by_user_id uuid NULL REFERENCES users (id) ON DELETE RESTRICT,
  request_id text NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz NULL,
  CONSTRAINT client_maturity_offers_schedule_fk FOREIGN KEY (maturity_schedule_id, user_id, fund_id)
    REFERENCES client_maturity_schedules (id, user_id, fund_id) ON DELETE RESTRICT,
  CONSTRAINT client_maturity_offers_state CHECK (state IN ('open', 'confirmed', 'withdrawn', 'superseded', 'closed')),
  CONSTRAINT client_maturity_offers_option CHECK (
    chosen_option IS NULL OR chosen_option IN ('return_all', 'one_time_and_sip', 'sip_extension')
  ),
  CONSTRAINT client_maturity_offers_sip_amount CHECK (sip_monthly_amount_paise > 0),
  CONSTRAINT client_maturity_offers_sip_start CHECK (
    EXTRACT(DAY FROM sip_start_month) = 1 AND sip_start_month BETWEEN DATE '2000-01-01' AND DATE '2199-12-01'
  ),
  CONSTRAINT client_maturity_offers_sip_months CHECK (sip_month_count BETWEEN 1 AND 600),
  CONSTRAINT client_maturity_offers_extension CHECK (
    (extension_months IS NULL AND next_maturity_date IS NULL)
    OR (
      extension_months IS NOT NULL AND next_maturity_date IS NOT NULL
      AND extension_months BETWEEN 1 AND 599
      AND next_maturity_date BETWEEN DATE '2000-01-01' AND DATE '2199-12-31'
    )
  ),
  CONSTRAINT client_maturity_offers_extension_choice CHECK (
    chosen_option IS DISTINCT FROM 'sip_extension' OR extension_months IS NOT NULL
  ),
  CONSTRAINT client_maturity_offers_choice_shape CHECK ((chosen_option IS NULL) = (chosen_at IS NULL)),
  CONSTRAINT client_maturity_offers_shape CHECK (
    (state = 'open' AND closed_at IS NULL AND closed_by_user_id IS NULL)
    OR (state <> 'open' AND closed_at IS NOT NULL AND closed_by_user_id IS NOT NULL)
  ),
  CONSTRAINT client_maturity_offers_confirmed CHECK (state <> 'confirmed' OR chosen_option IS NOT NULL),
  CONSTRAINT client_maturity_offers_version CHECK (version > 0),
  CONSTRAINT client_maturity_offers_request_id CHECK (btrim(request_id) <> '')
);

CREATE UNIQUE INDEX client_maturity_offers_open_uk
  ON client_maturity_offers (maturity_schedule_id)
  WHERE state = 'open';

CREATE INDEX client_maturity_offers_user_idx
  ON client_maturity_offers (user_id, state, created_at);

CREATE FUNCTION client_maturity_offers_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  mutable text[] := ARRAY['state', 'chosen_option', 'chosen_at', 'closed_by_user_id', 'closed_at', 'version', 'updated_at'];
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.state = 'open' AND (to_jsonb(NEW) - mutable) = (to_jsonb(OLD) - mutable) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'client_maturity_offers rows are never deleted, their figures never change, and a closed row never changes';
END;
$$;

CREATE TRIGGER client_maturity_offers_guard
  BEFORE UPDATE OR DELETE ON client_maturity_offers
  FOR EACH ROW EXECUTE FUNCTION client_maturity_offers_guard();

CREATE FUNCTION client_maturity_offers_refuse_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'client_maturity_offers rows are never deleted';
END;
$$;

CREATE TRIGGER client_maturity_offers_no_truncate
  BEFORE TRUNCATE ON client_maturity_offers
  FOR EACH STATEMENT EXECUTE FUNCTION client_maturity_offers_refuse_truncate();

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
      'maturity_options'
    )
  );

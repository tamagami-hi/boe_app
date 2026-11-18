CREATE TABLE client_value_entry_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL,
  user_id uuid NOT NULL,
  fund_id uuid NOT NULL,
  category text NOT NULL,
  set_by_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_value_entry_categories_entry_fk FOREIGN KEY (entry_id, user_id, fund_id)
    REFERENCES client_value_entries (id, user_id, fund_id) ON DELETE RESTRICT,
  CONSTRAINT client_value_entry_categories_entry_uk UNIQUE (entry_id),
  CONSTRAINT client_value_entry_categories_category CHECK (category IN ('one_time')),
  CONSTRAINT client_value_entry_categories_request_id CHECK (btrim(request_id) <> '')
);

CREATE INDEX client_value_entry_categories_user_idx ON client_value_entry_categories (user_id, fund_id);

CREATE FUNCTION client_value_entry_categories_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'client_value_entry_categories rows are append-only';
END;
$$;

CREATE TRIGGER client_value_entry_categories_append_only
  BEFORE UPDATE OR DELETE ON client_value_entry_categories
  FOR EACH ROW EXECUTE FUNCTION client_value_entry_categories_append_only();

CREATE TRIGGER client_value_entry_categories_no_truncate
  BEFORE TRUNCATE ON client_value_entry_categories
  FOR EACH STATEMENT EXECUTE FUNCTION client_value_entry_categories_append_only();

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
      'nominee_request_decided',
      'sip_early_exit',
      'investment_growth',
      'sip_payment_recorded',
      'one_time_investment_recorded'
    )
  );

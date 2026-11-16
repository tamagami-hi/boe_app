ALTER TABLE withdrawal_operations ALTER COLUMN maturity_id DROP NOT NULL;

CREATE TABLE sip_early_exits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  fund_id uuid NOT NULL REFERENCES funds (id) ON DELETE RESTRICT,
  ledger_entry_id uuid NOT NULL,
  payout_id uuid NOT NULL REFERENCES withdrawal_operations (id) ON DELETE RESTRICT,
  amount_paise bigint NOT NULL,
  principal_before_paise bigint NOT NULL,
  value_before_paise bigint NOT NULL,
  cancelled_maturity_schedule_id uuid NULL,
  effective_date date NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sip_early_exits_schedule_uk UNIQUE (schedule_id),
  CONSTRAINT sip_early_exits_ledger_entry_uk UNIQUE (ledger_entry_id),
  CONSTRAINT sip_early_exits_payout_uk UNIQUE (payout_id),
  CONSTRAINT sip_early_exits_maturity_schedule_uk UNIQUE (cancelled_maturity_schedule_id),
  CONSTRAINT sip_early_exits_schedule_fk FOREIGN KEY (schedule_id, user_id, fund_id)
    REFERENCES admin_sip_schedules (id, user_id, fund_id) ON DELETE RESTRICT,
  CONSTRAINT sip_early_exits_ledger_entry_fk FOREIGN KEY (ledger_entry_id, user_id, fund_id)
    REFERENCES client_value_entries (id, user_id, fund_id) ON DELETE RESTRICT,
  CONSTRAINT sip_early_exits_maturity_schedule_fk FOREIGN KEY (cancelled_maturity_schedule_id, user_id, fund_id)
    REFERENCES client_maturity_schedules (id, user_id, fund_id) ON DELETE RESTRICT,
  CONSTRAINT sip_early_exits_amount CHECK (amount_paise > 0 AND amount_paise = value_before_paise),
  CONSTRAINT sip_early_exits_principal CHECK (principal_before_paise >= 0),
  CONSTRAINT sip_early_exits_request_id CHECK (btrim(request_id) <> '')
);

CREATE INDEX sip_early_exits_user_idx ON sip_early_exits (user_id, created_at DESC, id DESC);

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
      'sip_early_exit'
    )
  );

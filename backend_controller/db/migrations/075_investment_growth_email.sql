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
      'investment_growth'
    )
  );

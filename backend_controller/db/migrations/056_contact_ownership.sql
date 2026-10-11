DROP INDEX applications_active_email_uk;
DROP INDEX applications_active_phone_uk;

CREATE UNIQUE INDEX applications_submitted_email_uk ON applications (email_normalized)
  WHERE state = 'submitted';
CREATE UNIQUE INDEX applications_submitted_phone_uk ON applications (phone_e164)
  WHERE state = 'submitted';

ALTER TABLE email_deliveries
  DROP CONSTRAINT email_deliveries_template_check,
  ADD CONSTRAINT email_deliveries_template_check CHECK (
    template_key IN (
      'application_rejected',
      'account_approved',
      'password_set_link',
      'password_reset_link',
      'password_app_download',
      'contact_phone_changed'
    )
  );

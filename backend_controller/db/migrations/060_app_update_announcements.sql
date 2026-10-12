CREATE TABLE app_update_announcements (
  id uuid PRIMARY KEY,
  version text NOT NULL,
  version_code integer NOT NULL,
  mandatory boolean NOT NULL,
  message text NULL,
  download_url text NOT NULL,
  recipient_count integer NOT NULL,
  app_config_version integer NULL,
  actor_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_update_announcements_once UNIQUE (version_code, mandatory),
  CONSTRAINT app_update_announcements_version CHECK (version ~ '^[0-9]+(\.[0-9]+){0,3}$'),
  CONSTRAINT app_update_announcements_version_code CHECK (version_code > 0),
  CONSTRAINT app_update_announcements_message CHECK (
    message IS NULL OR (btrim(message) <> '' AND char_length(message) <= 500)
  ),
  CONSTRAINT app_update_announcements_download_url CHECK (download_url ~ '^https://'),
  CONSTRAINT app_update_announcements_recipients CHECK (recipient_count >= 0),
  CONSTRAINT app_update_announcements_enforced CHECK (mandatory = (app_config_version IS NOT NULL))
);

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
      'app_update_notice'
    )
  );

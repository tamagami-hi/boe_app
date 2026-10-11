CREATE TABLE admin_email_messages (
  id uuid PRIMARY KEY,
  template_id uuid NOT NULL,
  template_revision integer NOT NULL,
  recipient_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  is_test boolean NOT NULL,
  bound_email_revision bigint NOT NULL,
  delivery_id uuid NOT NULL REFERENCES email_deliveries (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_email_messages_revision_fk FOREIGN KEY (template_id, template_revision)
    REFERENCES email_template_revisions (template_id, revision) ON DELETE RESTRICT,
  CONSTRAINT admin_email_messages_delivery_uk UNIQUE (delivery_id),
  CONSTRAINT admin_email_messages_binding CHECK (bound_email_revision > 0),
  CONSTRAINT admin_email_messages_test_recipient CHECK (NOT is_test OR recipient_user_id = actor_user_id)
);

CREATE INDEX admin_email_messages_recipient_idx
  ON admin_email_messages (recipient_user_id, is_test, created_at DESC);
CREATE INDEX admin_email_messages_template_idx
  ON admin_email_messages (template_id, created_at DESC);

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
      'admin_message'
    )
  );

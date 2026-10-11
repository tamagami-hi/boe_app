CREATE TABLE email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  preloaded boolean NOT NULL DEFAULT false,
  current_revision integer NOT NULL DEFAULT 1,
  archived_at timestamptz NULL,
  created_by_user_id uuid NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT email_templates_slug_uk UNIQUE (slug),
  CONSTRAINT email_templates_slug_shape CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 80),
  CONSTRAINT email_templates_name_shape CHECK (btrim(name) <> '' AND char_length(name) <= 120),
  CONSTRAINT email_templates_description_shape CHECK (char_length(description) <= 500),
  CONSTRAINT email_templates_current_revision CHECK (current_revision > 0),
  CONSTRAINT email_templates_version_positive CHECK (version > 0)
);

CREATE TABLE email_template_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES email_templates (id) ON DELETE RESTRICT,
  revision integer NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_by_user_id uuid NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_template_revisions_uk UNIQUE (template_id, revision),
  CONSTRAINT email_template_revisions_revision CHECK (revision > 0),
  CONSTRAINT email_template_revisions_subject CHECK (
    btrim(subject) <> '' AND char_length(subject) <= 150 AND subject !~ '[\r\n]'
  ),
  CONSTRAINT email_template_revisions_body CHECK (btrim(body) <> '' AND char_length(body) <= 5000)
);

WITH preloaded (slug, name, description, subject, body) AS (
  VALUES
    (
      'welcome-note',
      'Welcome note',
      'A short welcome for a client whose account is ready.',
      'Welcome to BeOnEdge',
      E'Hello {{first_name}},\n\nThank you for joining BeOnEdge. Your account is ready, and you can sign in to the app with your email address.\n\nIf you have any questions about getting started, contact our support team.'
    ),
    (
      'account-update',
      'Account update',
      'An update about the client''s account. Replace the bracketed line before sending.',
      'An update about your BeOnEdge account',
      E'Hello {{first_name}},\n\nWe are writing with an update about your BeOnEdge account.\n\n[Write the update here.]\n\nIf you have any questions, contact our support team.'
    ),
    (
      'support-follow-up',
      'Support follow-up',
      'A follow-up on a request the client raised. Replace the bracketed line before sending.',
      'Following up on your BeOnEdge request',
      E'Hello {{first_name}},\n\nWe are following up on the request you raised with BeOnEdge support.\n\n[Write the follow-up here.]\n\nIf anything is still unclear, contact our support team and we will help.'
    ),
    (
      'education-reminder',
      'Education reminder',
      'A reminder about learning resources. Replace the bracketed line before sending.',
      'A reminder from BeOnEdge',
      E'Hello {{first_name}},\n\nThis is a reminder about the learning resources available to you on BeOnEdge.\n\n[Write the reminder here.]\n\nInvestments are subject to market risk.'
    ),
    (
      'team-message',
      'General team message',
      'A general message from the team. Replace the bracketed line before sending.',
      'A message from the BeOnEdge team',
      E'Hello {{first_name}},\n\n[Write your message here.]'
    )
),
created AS (
  INSERT INTO email_templates (slug, name, description, preloaded)
  SELECT slug, name, description, true FROM preloaded
  RETURNING id, slug
)
INSERT INTO email_template_revisions (template_id, revision, subject, body)
SELECT created.id, 1, preloaded.subject, preloaded.body
FROM created JOIN preloaded ON preloaded.slug = created.slug;

-- BE-007e: canonical transactional-outbox and email delivery tables (additive).
-- Depends on 009 (applications, verification_tokens) and 010 (users,
-- activation_invites). Applied on the canonical baseline (runner >= 009).
--
-- The worker claim/lease state machine, exponential-backoff schedule,
-- AES-256-GCM envelope encryption, and SNS signature validation are enforced by
-- the command/worker layer. The database here enforces the structural
-- invariants: envelope all-or-null grouping, lease-field grouping, the
-- template<->subject matrix, and dedup/uniqueness.

DO $$ BEGIN
  CREATE TYPE outbox_state AS ENUM (
    'pending', 'processing', 'sending', 'delivered',
    'retryable_failed', 'dead_lettered', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE email_delivery_state AS ENUM (
    'queued', 'sending', 'sent', 'delivered',
    'retryable_failed', 'permanent_failed', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic text NOT NULL,
  event_type text NOT NULL,
  event_version integer NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  request_id uuid NOT NULL,
  causation_id uuid,
  correlation_id uuid,
  deduplication_key text NOT NULL,
  payload jsonb NOT NULL,
  state outbox_state NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  lease_expires_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outbox_events_dedup_uk UNIQUE (deduplication_key),
  CONSTRAINT outbox_events_topic_check CHECK (btrim(topic) <> ''),
  CONSTRAINT outbox_events_event_type_check CHECK (btrim(event_type) <> ''),
  CONSTRAINT outbox_events_aggregate_type_check CHECK (btrim(aggregate_type) <> ''),
  CONSTRAINT outbox_events_event_version_positive CHECK (event_version > 0),
  CONSTRAINT outbox_events_payload_object CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT outbox_events_attempts_nonneg CHECK (attempt_count >= 0),
  CONSTRAINT outbox_events_occurred_before_created CHECK (occurred_at <= created_at),
  -- Lease fields are all-present-or-all-null and present only while the row is
  -- in a transit state; the lease must expire after it was taken.
  CONSTRAINT outbox_events_lease_group CHECK (
    (locked_at IS NULL AND locked_by IS NULL AND lease_expires_at IS NULL)
    OR (
      locked_at IS NOT NULL AND locked_by IS NOT NULL AND lease_expires_at IS NOT NULL
      AND state IN ('processing', 'sending')
      AND lease_expires_at > locked_at
    )
  ),
  CONSTRAINT outbox_events_cancelled_state CHECK (cancelled_at IS NULL OR state = 'cancelled')
);

CREATE INDEX outbox_events_claim_idx ON outbox_events (available_at, created_at, id)
  WHERE state IN ('pending', 'retryable_failed');
CREATE INDEX outbox_events_lease_recovery_idx ON outbox_events (lease_expires_at, id)
  WHERE state IN ('processing', 'sending');

CREATE TABLE email_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_event_id uuid UNIQUE REFERENCES outbox_events (id) ON DELETE SET NULL,
  application_id uuid REFERENCES applications (id) ON DELETE RESTRICT,
  user_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  verification_token_id uuid,
  activation_invite_id uuid,
  template_key text NOT NULL,
  template_version text NOT NULL,
  recipient_ciphertext bytea,
  recipient_nonce bytea,
  recipient_hmac bytea NOT NULL,
  recipient_masked text NOT NULL,
  recipient_encryption_key_version text,
  suppression_hmac_key_version text NOT NULL,
  ses_configuration_set text NOT NULL,
  ses_message_id text,
  ses_request_id text,
  state email_delivery_state NOT NULL DEFAULT 'queued',
  attempt_count integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  last_error_code text,
  failure_detail_ciphertext bytea,
  failure_detail_nonce bytea,
  failure_detail_key_version text,
  sent_at timestamptz,
  delivered_at timestamptz,
  bounced_at timestamptz,
  complained_at timestamptz,
  cancelled_at timestamptz,
  erased_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,
  -- A token/invite can only accompany its own subject.
  CONSTRAINT email_deliveries_verification_fk
    FOREIGN KEY (verification_token_id, application_id)
    REFERENCES verification_tokens (id, application_id) ON DELETE RESTRICT,
  CONSTRAINT email_deliveries_activation_fk
    FOREIGN KEY (activation_invite_id, user_id)
    REFERENCES activation_invites (id, user_id) ON DELETE RESTRICT,
  CONSTRAINT email_deliveries_version_positive CHECK (version > 0),
  CONSTRAINT email_deliveries_subject_present CHECK (application_id IS NOT NULL OR user_id IS NOT NULL),
  CONSTRAINT email_deliveries_template_check CHECK (
    template_key IN ('verify_email', 'activation_invite', 'application_rejected')
  ),
  -- Template <-> reference matrix.
  CONSTRAINT email_deliveries_template_refs CHECK (
    (template_key = 'verify_email'
      AND verification_token_id IS NOT NULL AND activation_invite_id IS NULL)
    OR (template_key = 'activation_invite'
      AND activation_invite_id IS NOT NULL AND verification_token_id IS NULL)
    OR (template_key = 'application_rejected'
      AND verification_token_id IS NULL AND activation_invite_id IS NULL)
  ),
  -- Outbox FK required while transport is still live.
  CONSTRAINT email_deliveries_outbox_required CHECK (
    outbox_event_id IS NOT NULL OR state NOT IN ('queued', 'sending', 'retryable_failed')
  ),
  CONSTRAINT email_deliveries_template_key_check CHECK (btrim(template_key) <> ''),
  CONSTRAINT email_deliveries_template_version_check CHECK (btrim(template_version) <> ''),
  CONSTRAINT email_deliveries_config_set_check CHECK (btrim(ses_configuration_set) <> ''),
  CONSTRAINT email_deliveries_recipient_hmac_check CHECK (octet_length(recipient_hmac) = 32),
  -- Exact "no complete address" masking is enforced at the Zod boundary; the DB
  -- rejects blank and control characters only.
  CONSTRAINT email_deliveries_recipient_masked_check CHECK (
    btrim(recipient_masked) <> '' AND recipient_masked !~ '[[:cntrl:]]'
  ),
  CONSTRAINT email_deliveries_suppression_keyver_check CHECK (btrim(suppression_hmac_key_version) <> ''),
  CONSTRAINT email_deliveries_attempts_check CHECK (attempt_count BETWEEN 0 AND 8),
  CONSTRAINT email_deliveries_ses_message_id_len CHECK (ses_message_id IS NULL OR char_length(ses_message_id) <= 512),
  CONSTRAINT email_deliveries_ses_request_id_len CHECK (ses_request_id IS NULL OR char_length(ses_request_id) <= 512),
  CONSTRAINT email_deliveries_evidence_monotonic CHECK (
    (sent_at IS NULL OR sent_at >= created_at)
    AND (delivered_at IS NULL OR delivered_at >= created_at)
    AND (bounced_at IS NULL OR bounced_at >= created_at)
    AND (complained_at IS NULL OR complained_at >= created_at)
    AND (cancelled_at IS NULL OR cancelled_at >= created_at)
  ),
  -- Recipient PII envelope: ciphertext + 12-byte nonce + key version are all
  -- present or all null, include the 16-byte GCM tag, and are null after erasure.
  CONSTRAINT email_deliveries_recipient_envelope_group CHECK (
    (recipient_ciphertext IS NULL AND recipient_nonce IS NULL AND recipient_encryption_key_version IS NULL)
    OR (
      recipient_ciphertext IS NOT NULL AND octet_length(recipient_ciphertext) >= 16
      AND recipient_nonce IS NOT NULL AND octet_length(recipient_nonce) = 12
      AND recipient_encryption_key_version IS NOT NULL AND btrim(recipient_encryption_key_version) <> ''
    )
  ),
  CONSTRAINT email_deliveries_recipient_erased CHECK (erased_at IS NULL OR recipient_ciphertext IS NULL),
  -- Failure-detail envelope: same all-or-null rule.
  CONSTRAINT email_deliveries_failure_envelope_group CHECK (
    (failure_detail_ciphertext IS NULL AND failure_detail_nonce IS NULL AND failure_detail_key_version IS NULL)
    OR (
      failure_detail_ciphertext IS NOT NULL AND octet_length(failure_detail_ciphertext) >= 16
      AND failure_detail_nonce IS NOT NULL AND octet_length(failure_detail_nonce) = 12
      AND failure_detail_key_version IS NOT NULL AND btrim(failure_detail_key_version) <> ''
    )
  ),
  CONSTRAINT email_deliveries_failure_erased CHECK (erased_at IS NULL OR failure_detail_ciphertext IS NULL)
);

CREATE UNIQUE INDEX email_deliveries_ses_message_id_uk ON email_deliveries (ses_message_id)
  WHERE ses_message_id IS NOT NULL;
CREATE INDEX email_deliveries_admin_idx ON email_deliveries (state, created_at DESC, id DESC);
CREATE INDEX email_deliveries_application_idx ON email_deliveries (application_id, created_at DESC)
  WHERE application_id IS NOT NULL;
CREATE INDEX email_deliveries_user_idx ON email_deliveries (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE TABLE email_provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sns_message_id text NOT NULL,
  sns_topic_arn text NOT NULL,
  sns_type text NOT NULL,
  ses_event_type text,
  ses_message_id text,
  delivery_correlation_id uuid,
  email_delivery_id uuid REFERENCES email_deliveries (id) ON DELETE RESTRICT,
  payload_ciphertext bytea,
  payload_nonce bytea,
  payload_sha256 bytea NOT NULL,
  payload_key_version text,
  state text NOT NULL DEFAULT 'received',
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  expires_at timestamptz NOT NULL,
  erased_at timestamptz,
  CONSTRAINT email_provider_events_sns_message_id_uk UNIQUE (sns_message_id),
  CONSTRAINT email_provider_events_sns_type_check CHECK (
    sns_type IN ('Notification', 'SubscriptionConfirmation', 'UnsubscribeConfirmation')
  ),
  CONSTRAINT email_provider_events_ses_event_type_check CHECK (
    ses_event_type IS NULL OR ses_event_type IN (
      'Delivery', 'Bounce', 'Complaint', 'Reject', 'RenderingFailure', 'DeliveryDelay'
    )
  ),
  CONSTRAINT email_provider_events_state_check CHECK (
    state IN ('received', 'processed', 'ignored', 'unmatched')
  ),
  CONSTRAINT email_provider_events_digest_check CHECK (octet_length(payload_sha256) = 32),
  CONSTRAINT email_provider_events_processed_terminal CHECK (processed_at IS NULL OR state <> 'received'),
  CONSTRAINT email_provider_events_expiry CHECK (expires_at > received_at),
  -- Payload envelope: ciphertext + 12-byte nonce + key version all present or
  -- all null, include the GCM tag, and are null after erasure; digest survives.
  CONSTRAINT email_provider_events_envelope_group CHECK (
    (payload_ciphertext IS NULL AND payload_nonce IS NULL AND payload_key_version IS NULL)
    OR (
      payload_ciphertext IS NOT NULL AND octet_length(payload_ciphertext) >= 16
      AND payload_nonce IS NOT NULL AND octet_length(payload_nonce) = 12
      AND payload_key_version IS NOT NULL AND btrim(payload_key_version) <> ''
    )
  ),
  CONSTRAINT email_provider_events_erased CHECK (erased_at IS NULL OR payload_ciphertext IS NULL)
);

CREATE INDEX email_provider_events_received_idx ON email_provider_events (state, received_at, id)
  WHERE state = 'received';
CREATE INDEX email_provider_events_unmatched_idx
  ON email_provider_events (state, delivery_correlation_id, received_at, id)
  WHERE state = 'unmatched';
CREATE INDEX email_provider_events_ses_message_idx ON email_provider_events (ses_message_id);
CREATE INDEX email_provider_events_expiry_idx ON email_provider_events (expires_at, id);

CREATE TABLE email_suppressions (
  recipient_hmac bytea NOT NULL,
  suppression_hmac_key_version text NOT NULL,
  reason text NOT NULL,
  source_event_id uuid NOT NULL REFERENCES email_provider_events (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  lifted_at timestamptz,
  lifted_by_user_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  lift_reason text,
  PRIMARY KEY (recipient_hmac, suppression_hmac_key_version),
  CONSTRAINT email_suppressions_hmac_check CHECK (octet_length(recipient_hmac) = 32),
  CONSTRAINT email_suppressions_keyver_check CHECK (btrim(suppression_hmac_key_version) <> ''),
  CONSTRAINT email_suppressions_reason_check CHECK (reason IN ('bounce', 'complaint')),
  -- Lift fields are all-null or all-present with a bounded reason.
  CONSTRAINT email_suppressions_lift_group CHECK (
    (lifted_at IS NULL AND lifted_by_user_id IS NULL AND lift_reason IS NULL)
    OR (
      lifted_at IS NOT NULL AND lifted_by_user_id IS NOT NULL
      AND lift_reason IS NOT NULL AND char_length(lift_reason) BETWEEN 10 AND 1000
    )
  )
);

-- BE-007d: canonical RBAC / maker-checker / audit / platform tables (additive).
-- Depends on 010 (users). Applied on the canonical baseline (runner >= 009).

DO $$ BEGIN
  CREATE TYPE approval_state AS ENUM ('pending', 'approved', 'rejected', 'executed', 'stale', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE actor_type AS ENUM ('public', 'user', 'admin', 'system', 'provider');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT roles_code_uk UNIQUE (code),
  CONSTRAINT roles_code_check CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT roles_name_check CHECK (btrim(name) <> ''),
  CONSTRAINT roles_version_positive CHECK (version > 0)
);

CREATE TABLE permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT permissions_code_uk UNIQUE (code),
  CONSTRAINT permissions_code_check CHECK (code ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,2}$'),
  CONSTRAINT permissions_description_check CHECK (btrim(description) <> '')
);

CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
  permission_id uuid NOT NULL REFERENCES permissions (id) ON DELETE RESTRICT,
  granted_by_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_by_user_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  revoked_at timestamptz,
  PRIMARY KEY (role_id, permission_id, granted_at),
  CONSTRAINT role_permissions_revoke_group CHECK (
    (revoked_by_user_id IS NULL AND revoked_at IS NULL)
    OR (revoked_by_user_id IS NOT NULL AND revoked_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX role_permissions_active_uk ON role_permissions (role_id, permission_id)
  WHERE revoked_at IS NULL;

CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  role_id uuid NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
  granted_by_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_by_user_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  revoked_at timestamptz,
  PRIMARY KEY (user_id, role_id, granted_at),
  CONSTRAINT user_roles_revoke_group CHECK (
    (revoked_by_user_id IS NULL AND revoked_at IS NULL)
    OR (revoked_by_user_id IS NOT NULL AND revoked_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX user_roles_active_uk ON user_roles (user_id, role_id) WHERE revoked_at IS NULL;
CREATE INDEX user_roles_active_by_user_idx ON user_roles (user_id) WHERE revoked_at IS NULL;

CREATE TABLE approval_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type text NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  target_version bigint NOT NULL,
  canonical_payload jsonb NOT NULL,
  payload_hash bytea NOT NULL,
  state approval_state NOT NULL DEFAULT 'pending',
  maker_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  maker_reason text NOT NULL,
  checker_user_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  checker_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  rejected_at timestamptz,
  executed_at timestamptz,
  stale_at timestamptz,
  expired_at timestamptz,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT approval_actions_action_type_check CHECK (action_type IN (
    'fund.publish_investable_version', 'fund.resume', 'fund.archive_published',
    'fund_nav.correct', 'fund_aum.correct', 'investment_order.reverse',
    'redemption.approve_above_threshold', 'rbac.permissions.change'
  )),
  CONSTRAINT approval_actions_target_type_check CHECK (btrim(target_type) <> ''),
  CONSTRAINT approval_actions_target_version_positive CHECK (target_version > 0),
  CONSTRAINT approval_actions_payload_object CHECK (jsonb_typeof(canonical_payload) = 'object'),
  CONSTRAINT approval_actions_payload_hash_check CHECK (octet_length(payload_hash) = 32),
  CONSTRAINT approval_actions_maker_reason_check CHECK (char_length(maker_reason) BETWEEN 10 AND 1000),
  CONSTRAINT approval_actions_distinct_actors CHECK (checker_user_id IS NULL OR checker_user_id <> maker_user_id),
  CONSTRAINT approval_actions_version_positive CHECK (version > 0),
  CONSTRAINT approval_actions_expiry CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX approval_actions_live_uk
  ON approval_actions (action_type, target_type, target_id, target_version)
  WHERE state IN ('pending', 'approved');
CREATE INDEX approval_actions_queue_idx ON approval_actions (state, created_at, id)
  WHERE state IN ('pending', 'approved');

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_type actor_type NOT NULL,
  actor_user_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  command text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  from_state text,
  to_state text,
  reason_code text,
  reason_detail text,
  request_id uuid NOT NULL,
  idempotency_key text,
  entity_version bigint NOT NULL,
  ip_address inet,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT audit_events_command_check CHECK (btrim(command) <> ''),
  CONSTRAINT audit_events_entity_type_check CHECK (btrim(entity_type) <> ''),
  CONSTRAINT audit_events_version_positive CHECK (entity_version > 0),
  CONSTRAINT audit_events_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT audit_events_actor_user CHECK (actor_type NOT IN ('user', 'admin') OR actor_user_id IS NOT NULL),
  CONSTRAINT audit_events_user_agent CHECK (
    user_agent IS NULL OR (octet_length(user_agent) <= 512 AND user_agent !~ '[[:cntrl:]]')
  )
);

CREATE INDEX audit_events_entity_idx ON audit_events (entity_type, entity_id, occurred_at DESC, id DESC);
CREATE INDEX audit_events_actor_idx ON audit_events (actor_user_id, occurred_at DESC);
CREATE INDEX audit_events_request_idx ON audit_events (request_id);

CREATE TABLE idempotency_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_scope text NOT NULL,
  actor_scope_key_version text,
  http_method text NOT NULL,
  route_template text NOT NULL,
  key text NOT NULL,
  actor_user_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  request_hash bytea NOT NULL,
  response_status integer NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT idempotency_records_scope_uk UNIQUE (actor_scope, http_method, route_template, key),
  CONSTRAINT idempotency_records_hash_check CHECK (octet_length(request_hash) = 32),
  CONSTRAINT idempotency_records_method_check CHECK (http_method IN ('POST', 'PUT', 'PATCH', 'DELETE')),
  CONSTRAINT idempotency_records_status_check CHECK (response_status BETWEEN 100 AND 599),
  CONSTRAINT idempotency_records_body_object CHECK (jsonb_typeof(response_body) = 'object'),
  CONSTRAINT idempotency_records_completion CHECK (completed_at >= created_at),
  CONSTRAINT idempotency_records_expiry CHECK (expires_at > completed_at)
);

CREATE INDEX idempotency_records_expiry_idx ON idempotency_records (expires_at, id);

CREATE TABLE rate_limit_windows (
  bucket text NOT NULL,
  key_hash bytea NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (bucket, key_hash, window_start),
  CONSTRAINT rate_limit_windows_bucket_check CHECK (btrim(bucket) <> ''),
  CONSTRAINT rate_limit_windows_key_hash_check CHECK (octet_length(key_hash) = 32),
  CONSTRAINT rate_limit_windows_count_check CHECK (count > 0),
  CONSTRAINT rate_limit_windows_expiry CHECK (expires_at > window_start)
);

CREATE INDEX rate_limit_windows_cleanup_idx ON rate_limit_windows (expires_at, bucket, key_hash, window_start);

CREATE TABLE legal_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  reason text NOT NULL,
  placed_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  placed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  released_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  released_at timestamptz,
  CONSTRAINT legal_holds_entity_type_check CHECK (entity_type IN (
    'application', 'user', 'email_delivery', 'email_provider_event', 'audit_event',
    'investor_profile', 'kyc_case', 'risk_assessment', 'marketing_lead',
    'investment_order', 'payment', 'mandate'
  )),
  CONSTRAINT legal_holds_reason_check CHECK (char_length(reason) BETWEEN 10 AND 2000),
  CONSTRAINT legal_holds_expiry CHECK (expires_at IS NULL OR expires_at > placed_at),
  CONSTRAINT legal_holds_release_group CHECK (
    (released_by IS NULL AND released_at IS NULL)
    OR (released_by IS NOT NULL AND released_at IS NOT NULL)
  ),
  CONSTRAINT legal_holds_release_after CHECK (released_at IS NULL OR released_at >= placed_at)
);

CREATE UNIQUE INDEX legal_holds_unreleased_uk ON legal_holds (entity_type, entity_id)
  WHERE released_at IS NULL;
CREATE INDEX legal_holds_active_idx ON legal_holds (entity_type, entity_id, expires_at)
  WHERE released_at IS NULL;

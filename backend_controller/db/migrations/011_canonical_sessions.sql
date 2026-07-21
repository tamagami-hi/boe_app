-- BE-007c: canonical session tables (additive; first-slice).
-- Depends on 010 (users). Applied on the canonical baseline (runner >= 009).
-- The exact 30-second previous-pair grace and rotation-id lifecycle are enforced
-- by the application/command layer; the DB enforces structural invariants
-- (all-null-or-all-present pairs, channel/CSRF rules, single-current guards).

DO $$ BEGIN
  CREATE TYPE session_channel AS ENUM ('native', 'web');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE auth_session_state AS ENUM ('active', 'revoked', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  token_family_id uuid NOT NULL DEFAULT gen_random_uuid(),
  channel session_channel NOT NULL,
  device_id_hash bytea,
  state auth_session_state NOT NULL DEFAULT 'active',
  generation bigint NOT NULL DEFAULT 0,
  refresh_key_version text NOT NULL,
  previous_refresh_token_hash bytea,
  previous_refresh_key_version text,
  previous_refresh_valid_until timestamptz,
  last_rotation_id uuid,
  csrf_token_hash bytea,
  csrf_key_version text,
  previous_csrf_token_hash bytea,
  previous_csrf_key_version text,
  previous_csrf_valid_until timestamptz,
  csrf_expires_at timestamptz,
  csrf_rotated_at timestamptz,
  ip_address inet,
  user_agent text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revocation_reason text,
  expired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT auth_sessions_token_family_uk UNIQUE (token_family_id),
  CONSTRAINT auth_sessions_id_user_uk UNIQUE (id, user_id),
  CONSTRAINT auth_sessions_version_positive CHECK (version > 0),
  CONSTRAINT auth_sessions_generation_nonneg CHECK (generation >= 0),
  CONSTRAINT auth_sessions_refresh_keyver CHECK (btrim(refresh_key_version) <> ''),
  CONSTRAINT auth_sessions_device_hash CHECK (device_id_hash IS NULL OR octet_length(device_id_hash) = 32),
  CONSTRAINT auth_sessions_expiry CHECK (expires_at > created_at),
  CONSTRAINT auth_sessions_rotation_id CHECK (generation > 0 OR last_rotation_id IS NULL),
  CONSTRAINT auth_sessions_prev_refresh_group CHECK (
    (previous_refresh_token_hash IS NULL AND previous_refresh_key_version IS NULL AND previous_refresh_valid_until IS NULL)
    OR (previous_refresh_token_hash IS NOT NULL AND octet_length(previous_refresh_token_hash) = 32
        AND previous_refresh_key_version IS NOT NULL AND btrim(previous_refresh_key_version) <> ''
        AND previous_refresh_valid_until IS NOT NULL)
  ),
  CONSTRAINT auth_sessions_native_csrf_null CHECK (
    channel <> 'native' OR (
      csrf_token_hash IS NULL AND csrf_key_version IS NULL
      AND previous_csrf_token_hash IS NULL AND previous_csrf_key_version IS NULL
      AND previous_csrf_valid_until IS NULL AND csrf_expires_at IS NULL AND csrf_rotated_at IS NULL
    )
  ),
  CONSTRAINT auth_sessions_web_csrf_present CHECK (
    channel <> 'web' OR (
      csrf_token_hash IS NOT NULL AND octet_length(csrf_token_hash) = 32
      AND csrf_key_version IS NOT NULL AND btrim(csrf_key_version) <> ''
    )
  ),
  CONSTRAINT auth_sessions_prev_csrf_group CHECK (
    (previous_csrf_token_hash IS NULL AND previous_csrf_key_version IS NULL AND previous_csrf_valid_until IS NULL)
    OR (previous_csrf_token_hash IS NOT NULL AND octet_length(previous_csrf_token_hash) = 32
        AND previous_csrf_key_version IS NOT NULL AND btrim(previous_csrf_key_version) <> ''
        AND previous_csrf_valid_until IS NOT NULL)
  ),
  CONSTRAINT auth_sessions_user_agent CHECK (
    user_agent IS NULL OR (octet_length(user_agent) <= 512 AND user_agent !~ '[[:cntrl:]]')
  ),
  CONSTRAINT auth_sessions_revoked_ts CHECK (state <> 'revoked' OR revoked_at IS NOT NULL),
  CONSTRAINT auth_sessions_expired_ts CHECK (state <> 'expired' OR expired_at IS NOT NULL)
);

CREATE UNIQUE INDEX auth_sessions_active_native_device_uk ON auth_sessions (user_id, device_id_hash)
  WHERE channel = 'native' AND state = 'active' AND device_id_hash IS NOT NULL;
CREATE INDEX auth_sessions_active_expiry_idx ON auth_sessions (expires_at) WHERE state = 'active';
CREATE INDEX auth_sessions_user_created_idx ON auth_sessions (user_id, created_at DESC);

CREATE TABLE auth_refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  user_id uuid NOT NULL,
  generation bigint NOT NULL,
  token_hash bytea NOT NULL,
  token_key_version text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  replaced_by_token_id uuid REFERENCES auth_refresh_tokens (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_refresh_tokens_session_fk
    FOREIGN KEY (session_id, user_id) REFERENCES auth_sessions (id, user_id) ON DELETE CASCADE,
  CONSTRAINT auth_refresh_tokens_hash_uk UNIQUE (token_hash),
  CONSTRAINT auth_refresh_tokens_session_gen_uk UNIQUE (session_id, generation),
  CONSTRAINT auth_refresh_tokens_hash_check CHECK (octet_length(token_hash) = 32),
  CONSTRAINT auth_refresh_tokens_keyver_check CHECK (btrim(token_key_version) <> ''),
  CONSTRAINT auth_refresh_tokens_generation_nonneg CHECK (generation >= 0),
  CONSTRAINT auth_refresh_tokens_expiry CHECK (expires_at > created_at),
  CONSTRAINT auth_refresh_tokens_terminal CHECK (NOT (used_at IS NOT NULL AND revoked_at IS NOT NULL))
);

CREATE UNIQUE INDEX auth_refresh_tokens_current_uk ON auth_refresh_tokens (session_id)
  WHERE used_at IS NULL AND revoked_at IS NULL;
CREATE INDEX auth_refresh_tokens_unexpired_hash_idx ON auth_refresh_tokens (token_hash)
  WHERE used_at IS NULL AND revoked_at IS NULL;
CREATE INDEX auth_refresh_tokens_session_created_idx ON auth_refresh_tokens (session_id, created_at DESC);

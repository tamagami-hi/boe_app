-- 046_client_web_sessions.sql
--
-- A third session channel: `client_web`, the investor app running in a browser.
--
-- Why a channel of its own rather than reusing `web`.
--
-- Until now the client app had exactly one transport, the native bearer pair
-- (`channel = 'native'`), and `web` meant "the admin console's cookie session".
-- A browser cannot hold a bearer refresh token safely: the only place one
-- survives a full document load is `localStorage`, readable by any injected
-- script. So the browser client needs the cookie transport the admin console
-- already has.
--
-- It must not *share* it. `authenticateWebRequest` accepts any active session
-- whose channel is `web`; if a client browser session were also `web`, a client
-- cookie would satisfy the admin console's authentication step and be stopped
-- only by the permission check one layer further in. Authorization is not the
-- place to keep two audiences apart. With a separate channel the isolation is
-- structural and enforced by the same predicate that already keeps native and
-- web apart: the admin path requires `channel = 'web'`, the client cookie path
-- requires `channel = 'client_web'`, and neither accepts the other. The cookie
-- names differ too (`boe_client_access` vs `boe_access`), so the two sessions
-- coexist in one browser without either overwriting the other.
--
-- `auth_login_events.channel` is the same enum type, so client browser sign-ins
-- are recorded distinguishably from APK sign-ins in the per-user history.
--
-- No BEGIN/COMMIT: scripts/migrate.ts wraps this file in one transaction with
-- its `schema_migrations` row.
--
-- `ALTER TYPE ... ADD VALUE` is permitted inside a transaction block on
-- PostgreSQL 12+; what is forbidden is *using* the new value before that
-- transaction commits. Nothing below names `client_web` — the relaxed CHECK is
-- expressed against `native`, which is why it can live in the same file.

ALTER TYPE session_channel ADD VALUE IF NOT EXISTS 'client_web';

-- Migration 011 required the synchronizer CSRF pair on `channel = 'web'` rows
-- and (separately) forbade it on `native` rows. Restate the positive half as
-- "every non-native channel carries a CSRF token", so it covers `client_web`
-- without naming it. `auth_sessions_native_csrf_null` is unchanged and still
-- forbids CSRF material on native rows, so the two together remain exhaustive.
ALTER TABLE auth_sessions
  DROP CONSTRAINT auth_sessions_web_csrf_present,
  ADD CONSTRAINT auth_sessions_web_csrf_present CHECK (
    channel = 'native' OR (
      csrf_token_hash IS NOT NULL AND octet_length(csrf_token_hash) = 32
      AND csrf_key_version IS NOT NULL AND btrim(csrf_key_version) <> ''
    )
  );

COMMENT ON COLUMN auth_sessions.channel IS
  'native = APK bearer pair; web = admin console cookie session; client_web = investor app cookie session in a browser. Each channel is accepted only by its own authentication path.';

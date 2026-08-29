-- 047_admin_native_sessions.sql
--
-- A fourth session channel: `admin_native`, the admin console running as an APK.
--
-- Why a channel of its own rather than reusing `native`.
--
-- The admin console has two hosts, and 046 recorded the same shape for the
-- investor app. The browser console is served same-site with the API and
-- authenticates with the `boe_access` cookie (`channel = 'web'`). The Android
-- admin build is a Capacitor WebView served from `https://localhost`, a
-- different registrable domain from the API host, so every call is cross-site:
-- `SameSite=Lax` withholds the cookie and `validateWebOrigin` rejects
-- `Sec-Fetch-Site: cross-site` outright. It must therefore hold a bearer pair,
-- as the client APK does.
--
-- It must not hold the *client's* bearer pair. `authenticateNativeRequest`
-- admits any active session whose channel is `native`, and the admin bearer path
-- called it, so a plain investor's APK token satisfied the admin console's
-- *authentication* step and was stopped only by the permission check one layer
-- further in. Authorization is not the place to keep two audiences apart:
-- permissions are per-user, and one person can hold both. With a separate
-- channel the isolation is the same predicate that already separates `web` from
-- `client_web` — the client bearer path requires `native`, the admin bearer path
-- requires `admin_native`, and neither accepts the other.
--
-- `auth_login_events.channel` is the same enum type, so admin APK sign-ins are
-- recorded distinguishably from admin browser sign-ins and from client APK
-- sign-ins in the per-user history.
--
-- No BEGIN/COMMIT: scripts/migrate.ts wraps this file in one transaction with
-- its `schema_migrations` row.
--
-- `ALTER TYPE ... ADD VALUE` is permitted inside a transaction block on
-- PostgreSQL 12+; what is forbidden is *using* the new value before that
-- transaction commits. Nothing below names `admin_native` — every predicate is
-- expressed against the two cookie labels, which is why they can live in the
-- same file.

ALTER TYPE session_channel ADD VALUE IF NOT EXISTS 'admin_native';

-- Migration 011 split the CSRF rules by naming `native` on one side and `web` on
-- the other; 046 restated the positive half as "every non-native channel carries
-- a CSRF pair", which was exhaustive while every non-native channel was a cookie
-- channel. `admin_native` is not: it is a bearer transport and has no
-- synchronizer token, so both halves are restated in terms of the cookie
-- channels instead. Cookie channels must carry a CSRF pair; every other channel
-- must carry none. The two remain exhaustive and now stay exhaustive as bearer
-- channels are added.
ALTER TABLE auth_sessions
  DROP CONSTRAINT auth_sessions_web_csrf_present,
  ADD CONSTRAINT auth_sessions_web_csrf_present CHECK (
    channel NOT IN ('web', 'client_web') OR (
      csrf_token_hash IS NOT NULL AND octet_length(csrf_token_hash) = 32
      AND csrf_key_version IS NOT NULL AND btrim(csrf_key_version) <> ''
    )
  ),
  DROP CONSTRAINT auth_sessions_native_csrf_null,
  ADD CONSTRAINT auth_sessions_native_csrf_null CHECK (
    channel IN ('web', 'client_web') OR (
      csrf_token_hash IS NULL AND csrf_key_version IS NULL
      AND previous_csrf_token_hash IS NULL AND previous_csrf_key_version IS NULL
      AND previous_csrf_valid_until IS NULL AND csrf_expires_at IS NULL AND csrf_rotated_at IS NULL
    )
  );

-- Same-device replacement is what makes a re-login on one phone replace that
-- phone's session rather than accumulate another, and the partial unique index
-- is its backstop under concurrency: the row-level lock in `issueLoginSession`
-- serializes logins for one account, but a lock on rows that do not exist yet
-- guarantees nothing on a first login. Migration 011 scoped the index to
-- `channel = 'native'`, so an admin bearer session would have had no backstop at
-- all.
--
-- `channel` joins the key rather than only the predicate. Without it, one person
-- holding both APKs on one handset could collide across audiences on a shared
-- device hash; with it, each channel has its own uniqueness and the two can
-- never interfere. The predicate excludes the cookie channels, which have no
-- device identity.
DROP INDEX auth_sessions_active_native_device_uk;
CREATE UNIQUE INDEX auth_sessions_active_bearer_device_uk
  ON auth_sessions (user_id, channel, device_id_hash)
  WHERE state = 'active' AND device_id_hash IS NOT NULL
    AND channel NOT IN ('web', 'client_web');

COMMENT ON COLUMN auth_sessions.channel IS
  'native = client APK bearer pair; admin_native = admin APK bearer pair; web = admin console cookie session; client_web = investor app cookie session in a browser. Each channel is accepted only by its own authentication path.';

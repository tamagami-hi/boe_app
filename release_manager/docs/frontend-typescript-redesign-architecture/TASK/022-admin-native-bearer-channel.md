# 022 — A bearer session for the admin APK, so a shipped target can finally log in

Decision: D-053. Log: Entry 026. Mirrors 021 (D-052) in shape and in method.

## The problem

The admin Android target is not speculative. `package.json` ships `build:android:admin`,
`android:sync:admin` and `android:apk:admin`; `capacitor.config.ts` has an admin variant;
`frontend_stack_ts/resources/launcher/admin/` holds real branding; `emu/boe_update.sh --both` builds
it; `release_manager/tests/hermetic_branding.test.sh` makes 17 admin assertions.

It could not authenticate. Two independent reasons:

**The APK cannot use cookies.** A Capacitor WebView is served from `https://localhost`, a different
registrable domain from the API host, so every call is cross-site. `SameSite=Lax` withholds the cookie
on a cross-site subresource request and the backend's `validateWebOrigin` refuses
`Sec-Fetch-Site: cross-site` outright. `adminRuntime` was cookie-only and `buildAdminDevice` — named in
doc 03, doc 10 and the README — did not exist.

**There was no admin bearer login.** `resolveAdminPrincipal` already had a bearer leg, but it called
`authenticateNativeRequest`, which accepts any session on the `native` channel — the *investor* APK's
channel. So the only bearer token an admin request would accept was a client token that any account
holder can mint from `/v1/auth/native/login`. An investor's token passed admin **authentication**, and
the permission check was the only thing behind it.

That second point is the reason this is not merely a feature. D-052 had already argued the principle:
authorization is the wrong layer to separate two audiences, because permissions are per-user and one
person can hold both accounts. The admin bearer path was the counterexample sitting in the tree.

## What was built

### A fourth session channel

`047_admin_native_sessions.sql` adds `admin_native`, built the way 046 was — including the constraint
that shaped 046: `ALTER TYPE ... ADD VALUE` may run inside a transaction on PostgreSQL 12+, but the new
label cannot be *used* until that transaction commits, and the migration runner wraps each file in one.
So the file never names `admin_native`.

Where 046 could say "every non-native channel carries a CSRF pair", 047 cannot. `admin_native` is a
bearer transport with no synchronizer token, so that phrasing would demand a CSRF pair on a row that
must not have one. Both halves are restated against the two *cookie* labels instead:

- `auth_sessions_web_csrf_present` — the pair is required when `channel IN ('web','client_web')`
- `auth_sessions_native_csrf_null` — all CSRF material is forbidden otherwise

Still exhaustive, and still exhaustive as further bearer channels are added.

`auth_sessions_active_native_device_uk` was scoped to `channel = 'native'`, so an admin bearer session
would have had no same-device backstop. It becomes `auth_sessions_active_bearer_device_uk` on
`(user_id, channel, device_id_hash)` where the channel is not a cookie channel — `channel` in the key,
not just the predicate, so one person with both APKs on one handset cannot collide across audiences.

**This migration must be applied before the code that writes `admin_native` runs.** A backend serving
the new login against a database at 046 fails the session insert on an invalid enum value.

### One implementation, two scopes

`domain/auth/nativeAuth.ts` is now generic over a `NativeAuthScope`, exactly as `webAuth.ts` is generic
over a `WebAuthScope`. One `nativeLogin`, one `nativeRefresh`, one `authenticateBearerSession`; the
scope supplies the channel, the audit command, the audit actor type, the principal builder and the
login-eligibility rule. `CLIENT_NATIVE_SCOPE` sits beside them; `ADMIN_NATIVE_SCOPE` lives in
`domain/auth/adminNativeAuth.ts`.

Not a copy, for the reason D-052 gave: the 30-second previous-token grace, the same-`rotationId`
reproduction and the family revocation on reuse are the subtle parts and the parts a copy drifts on.

### Three endpoints

```
POST /v1/auth/admin/native/login     AdminNativeSessionData = WebPrincipal + bearer pair
POST /v1/auth/admin/native/refresh   rotation on the admin chain only
POST /v1/auth/admin/native/logout    revokes the family
```

98 → 101 contracted operations, 88 → 91 paths. The login returns the same `WebPrincipal` the cookie
login returns — roles and resolved permissions — so the console renders identically on both hosts and
`RequirePermission` works on device against one source of truth.

The client native login was **not** widened to return permissions. That was the smaller diff and the
worse design: it makes the two audiences' tokens interchangeable in exactly what they authorise.

No CSRF token and no Origin check on the three, and nothing is weakened: a bearer token is not an
ambient credential, and those checks exist to protect ambient credentials. The cookie path keeps all of
them.

### The resolver

`resolveAdminPrincipal` keeps its shape — cookie preferred when present, bearer only when there is no
access cookie *and* a `Bearer` header, so the browser console's behaviour and error codes are
unchanged even if a stale bearer is also sent. Its bearer leg now calls
`authenticateAdminNativeRequest`. All 11 admin route files were already on the resolver, so no route
changed and no permission check moved.

### The frontend

`adminRuntime` branches on `isNative()` the way `clientRuntime` does: Secure Storage with
`persistSecrets: isNative()`, a native refresh executor against the admin rotation endpoint, native
sign-in and sign-out, and a `nativeRestore` that re-establishes from the stored pair and then reads
`getAdminSession` live. The browser path is unchanged, recover-then-rotate refresh fix included.

`buildAdminDevice` and `buildClientDevice` are one builder in `src/platform/nativeDevice.ts` taking the
scope. `clientRuntime`'s three inlined copies of the device descriptor and the compatibility headers
now call it — the descriptor shape is load-bearing (the backend hashes `installationId` into
`device_id_hash`) and two hand-maintained copies is how it drifts. The installation id is per scope, so
the two APKs enrol as separate devices and their caps stay independent.

## Why you should believe the scopes are isolated

`src/domain/auth/scopeIsolation.test.ts` asserts D-052's four predicates for four scopes, in 20 tests:

1. The two cookie scopes share no cookie name; all four scopes declare distinct channels.
2. The full 4×4 matrix — every channel presented to every authenticator — resolves only on the
   diagonal. `authenticateBearerSession` takes the channel as a required parameter, so there is no
   default to get wrong and nothing inferred from the token.
3. `nativeRefresh` refuses a cross-channel refresh token, **before any write**, so a mismatched channel
   is not mistaken for refresh reuse and does not revoke the innocent session's family.
4. A login writes its own channel; `ADMIN_NATIVE_SCOPE.rejectLogin` refuses an account with no roles,
   so an investor cannot obtain an `admin_native` session at all.

An admin bearer does not work as a client bearer; a client bearer does not work as an admin bearer;
neither cookie works as either bearer.

## What is green, and what that does not mean

Green here: `tsc --noEmit`, `eslint`, and 744 backend unit tests, 186 frontend tests, 95 contract
tests, the admin Vite build, and the bypass gate at 101 = 101.

Green here does **not** mean the migration applies, the endpoints answer, or the APK signs in. The
isolation tests run against a stubbed database, not PostgreSQL. Entry 026 carries the exact VPS and
`adb` commands, and names the three things only a device will reveal: Secure Storage surviving process
death, `getAdminSession` being reachable with a bearer token, and the login screen's `AuthPort` actually
picking up the native path.

One assertion in that list matters more than the rest. When a client bearer is presented to
`/v1/admin/session`, the expected answer is `SESSION_INVALID`. If it answers `AUTHORIZATION_DENIED`,
the channel check did not fire and the permission check caught it — which is the defect this task
exists to close, not the fix.

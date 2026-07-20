# BE-010 Phase Log: Activation and Web/Native Auth (accelerated, single task)

Status: `ACTIVE` (native core landed; native-refresh rotation + web auth +
production wiring + legacy deletion remaining)

Mode: accelerated per user directive — one BE task (no sub-packets), critical
tests only (auth qualifies), `npm run check` + `npm run test:integration` gate.

## Landed so far (green, pushed)

- `src/auth/refreshDerivation.ts` — deterministic successor derivation
  (`base64url(HMAC-SHA256(refreshKey, domain|sid|gen|rotationId))`), SHA-256
  stored-hash, random generation-0 token.
- `src/auth/phone.ts` — `maskPhone` (`+CC******last4`) via `libphonenumber-js@1.13.8`.
- Repositories: `userRepository` (lockById/activate/lockByEmailWithCredential/
  findActiveRolesAndPermissions), `activationInviteRepository`
  (lockByTokenHash/accept), extended `authSessionRepository`
  (lockActiveNativeByUserAndDevice/lockActiveBySid/revokeSessionFamily).
- `domain/auth/nativeAuth.ts` — `activateUser` (invite -> Argon2id credential +
  activate + native session + refresh + audit atomically; breach-checked),
  `nativeLogin` (uniform INVALID_CREDENTIALS timing via dummy verify;
  same-device session replacement), `authenticateNativeRequest` (bearer -> ES256
  verify -> recheck active session/user), `nativeLogout` (family revoke).
- `routes/nativeAuthRoutes.ts` — `POST /v1/activations/complete`,
  `/v1/auth/native/login`, `/v1/auth/native/logout`.
- Critical integration test `authNative.integration.test.ts`: activation ->
  active user/credential/session; replay -> `TOKEN_ALREADY_USED`; login +
  same-device replacement; wrong-password/unknown -> `INVALID_CREDENTIALS`;
  logout revokes with a valid bearer, 401 without.

Gates: `npm run check` green; integration 31/31 (coverage 97.56% stmts / 86.2%
branch over repositories/routes/domain). Additive so far — backend JS unchanged
at 80.

Correctness note: refresh/CSRF successors are deterministically HMAC-derived and
stored as SHA-256(raw); this supersedes BE-009d's keyed-hash approach for the
rotation path (BE-009d `sessionTokens.ts` is now only a generic primitive).

## Native refresh rotation — LANDED

`POST /v1/auth/native/refresh` + `authSessionRepository.rotateRefresh` +
`nativeRefresh` command: consumes gen N, derives + inserts gen N+1
(`deriveRefreshToken`), 30s previous-pair grace reproduces the successor on the
identical rotationId without a write, any other reuse revokes the family. Bug
fixed during implementation: the reuse path must COMMIT the revocation, so the
command returns a `reuse_revoked` outcome (the route maps it to SESSION_INVALID)
instead of throwing, which would have rolled back the revoke. Integration 32/32;
`nativeAuth.ts` 97.65%.

## Web auth — LANDED

`domain/auth/webAuth.ts` + `routes/webAuthRoutes.ts`: `POST /v1/auth/web/login`
(HttpOnly `__Host-boe_*` cookies + synchronizer CSRF + roles/permissions),
`/v1/auth/web/refresh` (refresh+CSRF rotate together, 30s grace reproduce, reuse
revoke), `/v1/auth/web/logout` (CSRF + Origin/Sec-Fetch enforced, family revoke +
cookie expiry). `authenticateWebRequest` guard: cookie access verify -> session/
user recheck -> constant-time CSRF -> Origin allowlist. `createWebSession` +
`rotateWebRefresh` repository methods. Critical integration test authWeb (login/
cookies/roles, wrong password, refresh rotate + reuse revoke, logout with CSRF +
Origin rejection). Integration 35/35.

## Legacy deletion — DONE (BE-010 JS reduction 80 -> 76)

Deleted `security/auth.js`, `shared/services/authService.js` (+ signup test),
`shared/routes/authRoutes.js` (dead legacy signup/login on the old schema),
registered in `legacy-deletion.guard.test.ts`.

## Deferred (documented)

- `GET /v1/auth/web/csrf` reload recovery + the current-refresh/previous-CSRF
  partial-response mixed-pair recovery edge.
- Production `server.ts` route wiring + env composition (crypto/access-token
  PEMs, cookie/origin config) — a dedicated composition step wires public
  onboarding + native + web auth into the running server together.

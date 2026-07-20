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

## Remaining for BE-010

- Native refresh rotation (`/v1/auth/native/refresh`): consume gen N, derive +
  insert gen N+1, 30s previous-pair grace with matching rotationId, family reuse
  revocation.
- Web auth (`/v1/auth/web/{login,csrf,refresh,logout}`): HttpOnly cookies,
  synchronizer CSRF, Origin/Referer + Sec-Fetch-Site checks, CSRF rotation.
- Web auth guard + wiring routes into production `server.ts`.
- Delete `security/auth.js`, `shared/services/authService.js` (+ signup test),
  `shared/routes/authRoutes.js` once the native+web replacement is complete.

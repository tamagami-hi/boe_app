# BE-009d Phase Log: Refresh/CSRF Session-Token Primitives

Status: `DONE`

## Objective And Dependency Closure

- Objective: opaque refresh + synchronizer-CSRF token generation, keyed hashing,
  and constant-time verification; delete the legacy HS256 token module.
- Dependencies: BE-009a/c.
- Normative sources: `specifications/04` §4.1 (opaque refresh; CSRF hash in
  session; versioned key columns; raw value never persisted).
- Dominant risk: predictable tokens or non-constant-time comparison.
- Intentional behavior change: legacy HS256 access token removed (ES256 is
  authoritative from BE-009c).

## Atomic Units

- [x] `src/auth/sessionTokens.ts` (generate/hash/verify refresh + CSRF; key config).
- [x] Unit tests (match/mismatch, distinct keys, key-length validation).
- [x] Delete `src/security/tokens.js`; register in the deletion guard.
- [x] `npm run check` + `npm run test:integration` (24/24) green; JS 81 -> 80.
- [x] Records updated; commit/push.

## Replacement And Deletion Map

| New | Deleted | Guard |
|---|---|---|
| `src/auth/sessionTokens.ts` (+ `accessToken.ts` from BE-009c) | `src/security/tokens.js` (HS256) | `legacy-deletion.guard.test.ts`; unit tests |

## RED Evidence

- Honest note: authored with tests together and validated GREEN. Real typecheck
  RED: `Object.freeze` dropped the `SessionTokenService` contextual typing so the
  `matches*` params were implicitly `any`; fixed with explicit `(rawToken: string,
  storedHash: Buffer)` annotations. Deletion safety verified: no TS imports
  `security/tokens` (only the dead legacy `auth.js`, removed in BE-010).

## Implementation And Decisions

- `sessionTokens.ts`: `createSessionTokenService` generates 43-char opaque
  refresh/CSRF tokens and stores only their keyed HMAC-SHA-256 hashes under
  distinct versioned keys; `matchesRefreshToken`/`matchesCsrfToken` compare in
  constant time; `parseSessionTokenKeys` decodes/length-validates the two base64
  keys. Reuses `crypto/primitives` (`generateOpaqueToken`, `hmacSha256`,
  `bytesEqual`).
- Kept as a separate module (own 2-key config) so the public-onboarding
  `CryptoContext` is unchanged; BE-010 wires the session-token service into the
  rotation state machine.
- The rotation state machine (previous-pair 30s grace, family revocation) is
  BE-010. Legacy `security/auth.js` (request authn/authz) is deleted in BE-010
  with its Fastify guard replacement.

## GREEN Validation

| Gate | Command | Result |
|---|---|---|
| Unit check | `npm run check` | green |
| Integration | `npm run test:integration` | 24/24 (unchanged) |

## Reviews

- Code + security (focused inline review): high-entropy opaque tokens; only keyed
  hashes stored; constant-time comparison; distinct refresh/CSRF keys; raw tokens
  never logged. No CRITICAL/HIGH/MEDIUM.

## Metrics

- Source TS added: `src/auth/sessionTokens.ts`. Test: `sessionTokens.test.ts`.
- **Production JS/JSX deleted: 1 (`security/tokens.js`). Backend authored JS
  backlog 81 -> 80.**

## Risk, Rollback, And Resume

- Residual risk: rotation state machine + `security/auth.js` deletion pending
  (BE-010).
- Rollback shape: revert the BE-009d commit.
- Commit/push: conventional commit on `ts-migration/backend`; PR #1 updated.
- **BE-009 (security core) is DONE** across a-d (Argon2id, HIBP, ES256, refresh/
  CSRF); `security/{passwords,tokens}.js` deleted; `security/auth.js` -> BE-010.
- Exact next action: BE-010 activation + web/native auth routes + session
  repositories + CSRF, deleting `security/auth.js` and legacy auth routes.

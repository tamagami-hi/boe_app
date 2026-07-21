# BE-009c Phase Log: ES256 Access-Token Service

Status: `DONE`

## Objective And Dependency Closure

- Objective: ES256 access-JWT sign/verify with versioned `kid` selection.
- Dependencies: BE-009a (pinned `jose@6.2.3`).
- Normative sources: `specifications/04` §4.1; `05` §3.5.
- Dominant risk: accepting a token with the wrong key/issuer/audience/type.
- Intentional behavior change: none (additive; consumed by BE-010).

## Atomic Units

- [x] `src/auth/accessToken.ts` (`createAccessTokenService`: sign/verify).
- [x] Unit tests (round-trip, unknown kid, wrong audience, tampered/malformed).
- [x] `npm run check` + `npm run test:integration` (24/24) green.
- [x] Records updated; commit/push.

## Replacement And Deletion Map

| New | Superseded (deleted later) | Guard |
|---|---|---|
| `src/auth/accessToken.ts` | part of legacy `src/security/tokens.js` (deleted at BE-009d) | unit tests (round-trip + reject paths) |

## Implementation And Decisions

- `createAccessTokenService`: ES256 only. `sign` uses the configured current
  `kid`, sets header `{alg:ES256, kid, typ:access}` and claims iss/aud/sub/sid/jti
  (uuid)/iat/nbf/exp (10-minute TTL). `verify` reads the header `kid`, rejects a
  missing/unknown `kid`, selects that SPKI public key, and pins issuer, audience,
  ES256, `typ=access`, and <=30s clock skew; any failure -> AUTHENTICATION_REQUIRED.
  Signing and verification keys are imported lazily and cached; retired public
  keys stay configured for TTL + skew.
- Env parsing of the PEM/kid material is deferred to the wiring point (BE-010);
  tests construct config from a generated ES256 keypair.
- `security/tokens.js` (opaque/verification token helpers) is deleted with
  BE-009d once refresh/CSRF primitives replace the rest of it.

## GREEN Validation

| Gate | Command | Result |
|---|---|---|
| Unit check | `npm run check` | green (jose in source + dist smoke) |
| Integration | `npm run test:integration` | 24/24 (unchanged) |

## Reviews

- Code + security (focused inline review): ES256-only; unknown/missing `kid`
  rejected; issuer/audience/typ/skew pinned; verify failures collapse to a single
  AUTHENTICATION_REQUIRED (no oracle); keys never logged. No CRITICAL/HIGH/MEDIUM.

## Metrics

- Source TS added: `src/auth/accessToken.ts`. Test: `accessToken.test.ts`.
- Production JS/JSX deleted: 0 (additive; deletion with BE-009d). Backend
  authored JS backlog unchanged at 81 files.

## Risk, Rollback, And Resume

- Residual risk: not yet wired into auth routes (BE-010); env PEM parsing pending.
- Rollback shape: revert the BE-009c commit.
- Commit/push: conventional commit on `ts-migration/backend`; PR #1 updated.
- Exact next action: BE-009d refresh/CSRF token primitives + rotation helpers,
  then delete `security/{auth,tokens}.js`.

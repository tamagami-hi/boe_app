# BE-008b-1 Phase Log: Onboarding Crypto Primitives

Status: `DONE`

## Objective And Dependency Closure

- Objective: the `node:crypto` primitives + typed key config the submission,
  verification, and email worker consume.
- Dependencies: BE-007 (envelope shapes).
- Normative sources: `specifications/03` §3.3/§1, `04` §3.1.
- Dominant risk: weak/incorrect crypto.
- Intentional behavior change: none (new module).

## Atomic Units

- [x] `src/crypto/primitives.ts` — opaque token, keyed HMAC-SHA-256, AES-256-GCM
      envelope encrypt/decrypt, constant-time compare, email mask.
- [x] `src/crypto/context.ts` — key config parse + bound `CryptoContext`.
- [x] Unit tests: token format/uniqueness, HMAC determinism/size, envelope
      round-trip + tamper + key-length, mask, key parsing/validation.
- [x] `npm run check` + `npm run test:integration` (16/16) green.
- [x] Records updated; commit/push.

## Replacement And Deletion Map

| New | Superseded (deleted later) | Guard |
|---|---|---|
| `src/crypto/primitives.ts`, `src/crypto/context.ts` | part of legacy `src/security/tokens.js` (verification-token hashing); passwords/ES256 stay for BE-009 | unit tests (round-trip, tamper, format, key length) |

## Research And Reuse

- Pure `node:crypto` (`randomBytes`, `createHmac`, `createCipheriv`,
  `timingSafeEqual`); no external dependency. Key config mirrors the BE-003/BE-004
  Zod env-parse pattern.

## RED Evidence

- Honest note: authored with tests together and validated GREEN. One real RED:
  `tampered[0] ^= 0xff` failed strict `noUncheckedIndexedAccess` typecheck; fixed
  with `(tampered[0] ?? 0) ^ 0xff`. The tamper test itself proves GCM rejects a
  modified ciphertext.

## Implementation And Decisions

- `primitives.ts`: `generateOpaqueToken` (32 random bytes -> 43-char base64url,
  matching the verify-email regex, never persisted); `hmacSha256` (32-byte);
  `bytesEqual` (constant-time); `encryptGcm`/`decryptGcm` (AES-256-GCM, random
  12-byte nonce, 16-byte tag appended to ciphertext, 32-byte key enforced);
  `maskEmail` (first char of local + first char of domain label, no complete
  address).
- `context.ts`: `parseCryptoKeys` decodes and length-validates four base64 keys
  (token-hash, consent-IP HMAC, recipient/suppression HMAC, recipient AES-256
  encryption) with their versions; `createCryptoContext` binds them into
  `generateVerificationToken`/`hashToken`/`hmacConsentIp`/`hmacRecipient`/
  `encryptRecipient`/`decryptRecipient`/`maskEmail` plus the exposed
  `suppressionHmacKeyVersion`/`recipientEncryptionKeyVersion`.
- Decisions/deferrals: token hashes are peppered HMAC-SHA-256 (matching the
  `token_key_version` column) rather than plain SHA-256. Argon2id/HIBP/ES256/
  refresh rotation remain BE-009; SES/SNS sending BE-012; route/repository wiring
  + env threading is BE-008b-2.

## GREEN Validation

| Gate | Command | Result |
|---|---|---|
| Unit check | `npm run check` | green; `crypto/*` modules fully covered |
| Integration | `npm run test:integration` | 16/16 (unchanged; crypto has no DB use yet) |

## Reviews

- Code + security (focused inline review): AES-256-GCM with a fresh 12-byte nonce
  and authenticated tag (tamper test proves rejection); high-entropy opaque
  tokens with only a peppered hash persisted; constant-time HMAC comparison
  available; masked email exposes no complete address; keys decoded/validated and
  never logged or returned. No CRITICAL/HIGH/MEDIUM.

## Metrics

- Source TS added: `src/crypto/primitives.ts`, `src/crypto/context.ts`.
- Test TS added: `src/crypto/primitives.test.ts`, `src/crypto/context.test.ts`.
- Production JS/JSX deleted: 0 (legacy `security/*.js` deleted at BE-009).
  Backend authored JS backlog unchanged at 83 files.

## Risk, Rollback, And Resume

- Residual risk: primitives not yet consumed by a route until BE-008b-2.
- Rollback shape: revert the BE-008b-1 commit; remove `src/crypto/`.
- Commit/push: conventional commit on `ts-migration/backend`; PR #1 updated.
- Exact next action: BE-008b-2 — `POST /v1/applications` submission wiring the
  crypto context, the Application/Consent/VerificationToken/Outbox/EmailDelivery/
  Audit repositories, and the revised `executeIdempotent` (check-completed-first)
  against real PostgreSQL.

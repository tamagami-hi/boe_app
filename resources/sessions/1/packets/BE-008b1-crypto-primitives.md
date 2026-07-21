# BE-008b-1: Onboarding Crypto Primitives (child of BE-008)

- Status: `DONE`
- Owner surface: `backend_controller/src/crypto/**`, tests.
- Dependencies: BE-007 (schema envelope shapes).
- Objective: the `node:crypto` primitives the public submission + verification +
  email worker need — high-entropy opaque tokens with a peppered SHA-256/HMAC
  hash, keyed HMAC-SHA-256 (consent IP + email recipient/suppression), AES-256-GCM
  recipient envelopes (12-byte nonce, appended 16-byte tag), and email masking —
  plus the typed key configuration and a bound `CryptoContext`.
- Normative sources: `specifications/03` §3.3 (bytea envelope shapes: 32-byte
  hashes/HMACs, 12-byte nonce, >=16-byte GCM-tagged ciphertext), §1 (raw tokens
  never persisted), `04` §3.1 (consent IP HMAC + versioned key; masked recipient
  contains no complete address; token `^[A-Za-z0-9_-]{43}$`).
- Dominant risk: weak/incorrect crypto (short nonce, missing tag, reversible
  mask, wrong key length). Mitigation: AES-256-GCM with a random 12-byte nonce
  and appended tag proven by a round-trip + tamper test; token format asserted
  against the verify-email regex; mask asserted to hide the local part and any
  full address; key config rejects a non-32-byte AES key.
- Production replacement closure: `src/crypto/primitives.ts` (pure functions),
  `src/crypto/context.ts` (key config + `createCryptoContext`).
- Scope boundary / deferrals: Argon2id password hashing, HIBP, ES256 access
  tokens, and refresh rotation are BE-009 (`src/security/*.js`); this batch does
  not touch them. SES/SNS sending is BE-012. Route/repository wiring is BE-008b-2.
- Exact JS/JSX deletion target: none (new `src/crypto/` module; legacy
  `src/security/*.js` deleted at BE-009).
- Capability eval: a generated token matches `^[A-Za-z0-9_-]{43}$` and hashes to
  32 bytes; HMAC is deterministic and 32 bytes; `decrypt(encrypt(x)) === x` with
  a 12-byte nonce and a ciphertext that fails to decrypt when tampered; a masked
  email contains no `@`-complete address and no control characters; the key
  parser rejects a non-32-byte encryption key.
- Coverage/build gates: unit `npm run check` green; `npm run test:integration`
  still green.
- Required reviews: general + security (no raw token/plaintext/PII logged; keys
  never serialized).
- Rollback shape: revert the BE-008b-1 commit; remove `src/crypto/`.
- Done condition: check + integration green; records updated; commit pushed; PR
  updated; Legacy hash `d5fd7425...`.
- Phase log: [BE-008b-1 log](../logs/BE-008b1-crypto-primitives.md)

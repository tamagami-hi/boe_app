# BE-009a Phase Log: Argon2id Password Hasher

Status: `DONE`

## Objective And Dependency Closure

- Objective: Argon2id password hashing + `PasswordInput`, replacing legacy scrypt.
- Dependencies: BE-007.
- Normative sources: `specifications/02` §3.5, `03` user_credentials, `04` §2.1,
  `05` deps.
- Dominant risk: weak parameters / password logging.
- Intentional behavior change: credential hashing moves from scrypt to Argon2id
  (the canonical `user_credentials.password_hash` requires the `$argon2id$`
  prefix).

## Atomic Units

- [x] Add pinned deps `argon2@0.44.0` + `jose@6.2.3`; approve `argon2` install
      script in `allowScripts` (prebuilt binary, no compile).
- [x] `src/auth/passwordHasher.ts` (hash/verify/dummy + PasswordInput).
- [x] Delete `src/security/passwords.js`; register in the deletion guard.
- [x] Unit tests (hash/verify round-trip, PasswordInput, dummy).
- [x] `npm run check` + `npm run test:integration` (24/24) green; JS 82 -> 81.
- [x] Records updated; commit/push.

## Replacement And Deletion Map

| New | Deleted | Guard |
|---|---|---|
| `src/auth/passwordHasher.ts` (Argon2id) | `src/security/passwords.js` (scrypt) | `legacy-deletion.guard.test.ts`; unit tests |

## RED Evidence

- Honest note: authored with tests together and validated GREEN. The dependency
  install was a genuine gate: `argon2@0.44.0`'s install script was blocked by
  `strict-allow-scripts`; approving exactly `argon2@0.44.0` in `allowScripts` let
  `node-gyp-build` load the shipped linux-x64 prebuild (no compilation), verified
  by hashing/verifying in source and in the emitted `dist` smoke.

## Implementation And Decisions

- `passwordHasher.ts`: OWASP Argon2id parameters (`memoryCost 19456`, `timeCost 2`,
  `parallelism 1`); `hashPassword` returns the encoded `$argon2id$...` string;
  `verifyPassword` checks it; `verifyDummyPassword` performs a bounded dummy
  verification against a lazily-computed placeholder hash and always resolves
  false (timing equalisation for unknown-identifier/no-credential paths).
  `passwordInputSchema` enforces 12-128 code points and no control characters;
  passwords are not trimmed/normalized.
- Placed under `src/auth/` to avoid a basename collision with the legacy
  `src/security/passwords.js` (Vite resolves `.js` over `.ts` for a shared name).
- Decisions: chose the spec-documented native `argon2` (prebuilt binary works in
  the sandbox) over a WASM alternative. `jose@6.2.3` is pinned now and consumed
  by BE-009c (ES256). Breach check (BE-009b), ES256 (BE-009c), refresh rotation
  (BE-009d) follow; legacy `security/{auth,tokens}.js` are deleted as those land.

## GREEN Validation

| Gate | Command | Result |
|---|---|---|
| Unit check | `npm run check` | green (argon2 in source + dist smoke) |
| Integration | `npm run test:integration` | 24/24 vs PostgreSQL 16 (unchanged) |

## Reviews

- Code + security (focused inline review): OWASP Argon2id parameters; encoded
  hash matches the DB prefix CHECK; passwords never trimmed/normalized/logged;
  dummy verify equalises timing; deletion is safe (no TS consumer). No
  CRITICAL/HIGH/MEDIUM.

## Metrics

- Deps added (pinned): `argon2@0.44.0`, `jose@6.2.3`; `allowScripts` approves
  `argon2@0.44.0`.
- Source TS added: `src/auth/passwordHasher.ts`. Test: `passwordHasher.test.ts`.
- **Production JS/JSX deleted: 1 (`security/passwords.js`). Backend authored JS
  backlog 82 -> 81.**

## Risk, Rollback, And Resume

- Residual risk: `jose` is added but unused until BE-009c; breach check pending.
- Rollback shape: revert the BE-009a commit.
- Commit/push: conventional commit on `ts-migration/backend`; PR #1 updated.
- Exact next action: BE-009b breach check (HIBP k-anonymity, injectable fetch),
  then BE-009c ES256 access tokens (jose), BE-009d refresh/CSRF rotation.

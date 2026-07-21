# BE-009a: Argon2id Password Hasher (child of BE-009)

- Status: `DONE`
- Owner surface: `backend_controller/src/auth/**`, `package.json`, tests; deletes
  `src/security/passwords.js`.
- Dependencies: BE-007 (user_credentials schema).
- Objective: the Argon2id password hashing service (hash/verify/dummy-verify) and
  the `PasswordInput` scalar, replacing the legacy scrypt module.
- Normative sources: `specifications/02` §3.5, `03` user_credentials (encoded
  `$argon2id$` prefix, bounded dummy verify), `04` §2.1 (PasswordInput 12-128
  code points, no NUL/control), `05` deps (`argon2@0.44.0`, `jose@6.2.3`).
- Production replacement closure: `src/auth/passwordHasher.ts`
  (`hashPassword`/`verifyPassword`/`verifyDummyPassword`/`passwordInputSchema`).
  Deletes `src/security/passwords.js`.
- Scope boundary / deferrals: breach check (BE-009b), ES256 access tokens
  (BE-009c), refresh/CSRF rotation (BE-009d), auth routes (BE-010). `jose@6.2.3`
  is added now (pinned) and consumed by BE-009c.
- Exact JS/JSX deletion target: `src/security/passwords.js` (backend JS 82 -> 81).
- Capability eval: a hashed password is `$argon2id$`-prefixed and verifies true
  for the correct password and false otherwise; dummy verify resolves false;
  PasswordInput rejects short and control-character values.
- Coverage/build gates: unit `npm run check` green (argon2 loads in source + dist
  smoke); `npm run test:integration` green.
- Required reviews: general + security (no password logged; OWASP Argon2id
  parameters; timing-safe dummy verify).
- Rollback shape: revert the BE-009a commit (restores the deleted file + removes
  deps).
- Done condition: check + integration green; JS 81; records updated; commit
  pushed; PR updated; Legacy hash `d5fd7425...`.
- Phase log: [BE-009a log](../logs/BE-009a-password-hasher.md)

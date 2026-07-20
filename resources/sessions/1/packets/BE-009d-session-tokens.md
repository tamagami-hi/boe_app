# BE-009d: Refresh/CSRF Session-Token Primitives (child of BE-009)

- Status: `DONE`
- Owner surface: `backend_controller/src/auth/**`, tests; deletes
  `src/security/tokens.js`.
- Dependencies: BE-009a/c.
- Objective: opaque refresh + CSRF token generation, keyed hashing, and
  constant-time verification; remove the legacy HS256 token module.
- Normative sources: `specifications/04` §4.1.
- Production replacement closure: `src/auth/sessionTokens.ts`. Deletes
  `src/security/tokens.js`.
- Scope boundary / deferrals: rotation state machine + `security/auth.js`
  deletion (BE-010).
- Exact JS/JSX deletion target: `src/security/tokens.js` (81 -> 80).
- Capability eval: generated tokens are 43-char opaque, hash to 32 bytes, match
  their stored hash and reject a wrong token; refresh and CSRF use distinct keys;
  short keys are rejected.
- Coverage/build gates: unit `npm run check` green; `npm run test:integration`
  green.
- Required reviews: general + security (opaque tokens; keyed hashes only;
  constant-time compare; deletion safe).
- Rollback shape: revert the BE-009d commit.
- Done condition: check + integration green; JS 80; records updated; commit
  pushed; PR updated; Legacy hash `d5fd7425...`. Closes BE-009.
- Phase log: [BE-009d log](../logs/BE-009d-session-tokens.md)

# BE-010a: Auth Session + Credential Repositories (child of BE-010)

- Status: `DONE`
- Owner surface: `backend_controller/src/repositories/**`, `test/integration/**`.
- Dependencies: BE-007 (sessions schema), BE-009 (security core).
- Objective: the native-session DB layer — credential store and native session +
  refresh creation / refresh-hash lookup / family revocation — proven on
  PostgreSQL 16.
- Normative sources: `specifications/03` §7, `04` §4.1; migration 011.
- Production replacement closure: `src/repositories/credentialRepository.ts`,
  `src/repositories/authSessionRepository.ts`.
- Scope boundary / deferrals: web (cookie + CSRF) sessions + refresh rotation
  state machine (BE-010c); activation command (BE-010b); `security/auth.js`
  deletion + auth guard (BE-010c). Additive — no JS deletion here.
- Exact JS/JSX deletion target: none.
- Capability eval: a credential is created and detected; a native session +
  generation-0 refresh token are created atomically and located by refresh hash
  under a row lock (unknown hash -> null); `revokeAllForUser` revokes the active
  session and current refresh token and reports the counts.
- Coverage/build gates: unit `npm run check` green; `npm run test:integration`
  green with its coverage gate (99.64% stmts).
- Required reviews: general + security (only hashes stored; native CSRF fields
  null; row locks on lookup).
- Rollback shape: revert the BE-010a commit.
- Done condition: check + integration green; records updated; commit pushed; PR
  updated; Legacy hash `d5fd7425...`.
- Phase log: [BE-010a log](../logs/BE-010a-auth-session-repositories.md)

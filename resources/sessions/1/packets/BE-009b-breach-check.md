# BE-009b: Breached-Password Check (child of BE-009)

- Status: `DONE`
- Owner surface: `backend_controller/src/auth/**`, tests.
- Dependencies: BE-009a.
- Objective: the HIBP k-anonymity breached-password checker consumed by
  activation and password-change commands.
- Normative sources: `specifications/04` §4.1 (k-anonymity range API, padded
  responses, constant-time suffix compare, 2s timeout, 24h prefix cache,
  positive-count -> VALIDATION_FAILED, fail-closed DEPENDENCY_UNAVAILABLE, bypass
  only in test/development, login never calls HIBP).
- Production replacement closure: `src/auth/breachCheck.ts`
  (`createHibpBreachChecker`, `createBypassBreachChecker`, `createBreachChecker`,
  `resolveBreachCheckMode`).
- Scope boundary / deferrals: ES256 access tokens (BE-009c); refresh/CSRF
  rotation (BE-009d); wiring into the activation command (BE-010). Additive — no
  JS deletion (the legacy code had no breach check).
- Exact JS/JSX deletion target: none.
- Capability eval: a breached suffix (count > 0) throws VALIDATION_FAILED; a
  padding-only suffix (count 0) resolves; a repeated prefix hits the cache (one
  request); a non-2xx or a rejected request fails closed with
  DEPENDENCY_UNAVAILABLE; bypass resolves without any request; production+bypass
  is rejected at mode resolution.
- Coverage/build gates: unit `npm run check` green (offline via injected fetch);
  `npm run test:integration` green.
- Required reviews: general + security (only the 5-char prefix leaves the
  process; password/full-SHA-1/suffix/match never logged; constant-time compare;
  fail-closed).
- Rollback shape: revert the BE-009b commit.
- Done condition: check + integration green; records updated; commit pushed; PR
  updated; Legacy hash `d5fd7425...`.
- Phase log: [BE-009b log](../logs/BE-009b-breach-check.md)

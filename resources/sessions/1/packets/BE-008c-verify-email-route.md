# BE-008c: Verify-Email Route + First Onboarding JS Deletion (child of BE-008)

- Status: `DONE`
- Owner surface: `backend_controller/src/domain/onboarding/**`, `src/routes/**`,
  `src/repositories/**`, tests; deletes `src/website/services/onboardingService.js`.
- Dependencies: BE-008b-2.
- Objective: `POST /v1/applications/verify-email` end-to-end (single-use token
  consumes and moves the application to `submitted`), and the first backend
  JavaScript deletion now that the TypeScript onboarding surface replaces it.
- Normative sources: `specifications/04` §3.1 (verify-email: 200 `{verified:true}`,
  409 `TOKEN_ALREADY_USED` replay, 410 `TOKEN_EXPIRED`, token is the idempotency
  boundary, no idempotency header).
- Production replacement closure: `verifyApplicationEmail` command + verify route;
  `verificationTokenRepository.lockByHash`/`consume` +
  `applicationRepository.markEmailVerified`. Deletes
  `website/services/onboardingService.js`; guarded by `legacy-deletion.guard.test.ts`.
- Scope boundary / deferrals: cooldown resend + cross-match + race savepoint
  (BE-008b-3); the legacy `publicRoutes.js` monolith (BE-013).
- Exact JS/JSX deletion target: `src/website/services/onboardingService.js`
  (backend authored JS 83 -> 82).
- Capability eval: a valid token returns 200 and sets the application to
  `submitted` with `email_verified_at`; a replay is 409 `TOKEN_ALREADY_USED`; an
  unknown token is 400 `TOKEN_INVALID`; an expired token is 410 `TOKEN_EXPIRED`.
- Coverage/build gates: unit `npm run check` green; `npm run test:integration`
  green with its coverage gate.
- Required reviews: general + security (no application id/state leaked; token
  single-use; deletion is safe — no TS consumer, legacy graph has no entrypoint).
- Rollback shape: revert the BE-008c commit (restores the deleted file).
- Done condition: check + integration green; JS count 82; records updated; commit
  pushed; PR updated; Legacy hash `d5fd7425...`.
- Phase log: [BE-008c log](../logs/BE-008c-verify-email-route.md)

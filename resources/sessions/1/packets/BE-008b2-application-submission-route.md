# BE-008b-2: Application Submission Route (child of BE-008)

- Status: `DONE`
- Owner surface: `backend_controller/src/repositories/**`, `src/domain/onboarding/**`,
  `src/routes/**`, `src/http/idempotencyProtocol.ts`, `vitest*.config.ts`, tests.
- Dependencies: BE-006 (boundary), BE-007 (schema/seed/§7), BE-008a, BE-008b-1
  (crypto).
- Objective: `POST /v1/applications` end-to-end with a uniform 202 response,
  database-backed idempotency, and atomic creation of the application, consent
  evidence, verification token (hash only), email delivery, outbox trigger, and
  audit event on real PostgreSQL 16.
- Normative sources: `specifications/04` §2.1 (scalars), §2.2 (envelope), §3.1
  (`POST /v1/applications`), §3 (idempotency required, `MaskedEmail`).
- Production replacement closure: repository impls (`applicationRepository`,
  `consentRepository.recordAcceptances`, `verificationTokenRepository`,
  `outboxRepository`, `emailDeliveryRepository`, `auditRepository`,
  `idempotencyRepository`), the `submitApplication` command, the route, and the
  corrected `executeIdempotent` (check-completed-first). Unit-only coverage now
  excludes `repositories/routes/domain`; an integration coverage gate covers them.
- Scope boundary / deferrals: duplicate-pending 15-minute cooldown resend +
  cross-match security metric + concurrent-uniqueness-race savepoint -> BE-008b-3;
  verify-email + `onboardingService.js` deletion -> BE-008c; SES/SNS sending +
  transient-token hardening -> BE-012.
- Exact JS/JSX deletion target: none (deletion lands in BE-008c).
- Capability eval: a new pair returns 202 and creates 1 application (pending),
  2 consents, 1 token, 1 queued verify_email delivery, 1 outbox, 1 audit; a
  repeated idempotency key replays (meta.idempotencyReplay true) with no new
  rows; a duplicate identity with a different key is a uniform 202 no-op; a
  missing Idempotency-Key and a stale consent version both return 400.
- Coverage/build gates: unit `npm run check` green; `npm run test:integration`
  green with its own coverage gate.
- Required reviews: general + security (uniform response, no raw PII/token stored
  in plaintext except the documented transient outbox token, redacted audit).
- Rollback shape: revert the BE-008b-2 commit.
- Done condition: check + integration green; records updated; commit pushed; PR
  updated; Legacy hash `d5fd7425...`.
- Phase log: [BE-008b-2 log](../logs/BE-008b2-application-submission-route.md)

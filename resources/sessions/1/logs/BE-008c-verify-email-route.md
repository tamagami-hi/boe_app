# BE-008c Phase Log: Verify-Email Route + First Onboarding JS Deletion

Status: `DONE`

## Objective And Dependency Closure

- Objective: `POST /v1/applications/verify-email` end-to-end and the first backend
  JavaScript deletion.
- Dependencies: BE-008b-2.
- Normative sources: `specifications/04` §3.1.
- Dominant risk: token reuse or leaking application state.
- Intentional behavior change: the TS onboarding surface replaces the legacy
  onboarding service, which is deleted.

## Atomic Units

- [x] `verificationTokenRepository.lockByHash`/`consume`;
      `applicationRepository.markEmailVerified`.
- [x] `verifyApplicationEmail` command; verify route.
- [x] Delete `website/services/onboardingService.js`; add
      `legacy-deletion.guard.test.ts`.
- [x] Integration tests: valid -> submitted + replay 409; unknown 400; expired 410.
- [x] `npm run check` + `npm run test:integration` (24/24) green; JS 83 -> 82.
- [x] Records updated; commit/push.

## Replacement And Deletion Map

| New | Deleted | Guard |
|---|---|---|
| `domain/onboarding/verifyApplicationEmail.ts` + verify route + token repo methods | `src/website/services/onboardingService.js` | `legacy-deletion.guard.test.ts` asserts absence; integration proves the new flow |

## RED Evidence

- Honest note: authored with tests together and validated GREEN. Deletion safety
  was verified before removal: no TypeScript file references `onboardingService`
  (only the dead legacy `publicRoutes.js` imports it), and there is no legacy
  `server.js` entrypoint (the TS `server.ts` is the only entrypoint), so the
  legacy graph is unreachable.

## Implementation And Decisions

- `verifyApplicationEmail`: hashes the presented token, locks the row `FOR
  UPDATE`, and rejects unknown/wrong-purpose/revoked as `TOKEN_INVALID`, an
  already-consumed token as `TOKEN_ALREADY_USED` (409), and an expired token as
  `TOKEN_EXPIRED` (410); otherwise consumes the token and transitions the
  application `pending_email_verification -> submitted` (setting
  `email_verified_at`/`submitted_at`, bumping `version`) and appends an audit
  event. The public response is `{verified:true}` with no application id/state.
- `markEmailVerified` guards `where state = 'pending_email_verification'` so a
  double transition cannot regress state; the consumed-token check already blocks
  replays.
- Verify carries no idempotency header — the single-use token is the boundary.
- Deleted `website/services/onboardingService.js`; `legacy-deletion.guard.test.ts`
  is the forward-looking registry that keeps deleted legacy files gone.
- Deferrals: cooldown resend + cross-match + race savepoint (BE-008b-3);
  `publicRoutes.js` monolith (BE-013).

## GREEN Validation

| Gate | Command | Result |
|---|---|---|
| Unit check | `npm run check` | green (incl. deletion-guard test) |
| Integration | `npm run test:integration` | 24/24 vs PostgreSQL 16; coverage gate 99.58% stmts / 88.46% branch |

## Reviews

- Code + security (focused inline review): token is single-use (consumed +
  status checks under a row lock); the public response never exposes the
  application id or state; the transition is atomic with the audit trail; the
  legacy deletion is safe and guarded. No CRITICAL/HIGH/MEDIUM.

## Metrics

- Source TS added: `domain/onboarding/verifyApplicationEmail.ts`; verify route +
  repository methods.
- Test added: verify-email integration tests (integration 21 -> 24);
  `legacy-deletion.guard.test.ts` (unit).
- **Production JS/JSX deleted: 1 (`onboardingService.js`). Backend authored JS
  backlog 83 -> 82.**

## Risk, Rollback, And Resume

- Residual risk: cooldown resend + race savepoint still pending (BE-008b-3).
- Rollback shape: revert the BE-008c commit.
- Commit/push: conventional commit on `ts-migration/backend`; PR #1 updated.
- Exact next action: BE-008b-3 (cooldown resend + cross-match + race savepoint),
  then BE-009 password/token/session security core (deletes `src/security/*.js`).

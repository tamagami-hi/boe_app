# BE-008b-2 Phase Log: Application Submission Route

Status: `DONE`

## Objective And Dependency Closure

- Objective: `POST /v1/applications` end-to-end (uniform 202, DB idempotency,
  atomic multi-table creation) on PostgreSQL 16.
- Dependencies: BE-006, BE-007, BE-008a, BE-008b-1.
- Normative sources: `specifications/04` §2.1/§2.2/§3.1/§3.
- Dominant risk: leaking a duplicate outcome, or a non-atomic/incorrect idempotency
  protocol.
- Intentional behavior change: none externally (new route); internal correction to
  `executeIdempotent` (check-completed-first) and to `maskEmail` (full domain).

## Atomic Units

- [x] Repository impls: application (hasActiveConflict, createSubmission), consent
      recordAcceptances, verification token, outbox, email delivery, audit,
      idempotency (advisory lock + completed store).
- [x] `submitApplication` command (consent resolution, conflict no-op, atomic
      create).
- [x] Route `POST /v1/applications` (Idempotency-Key, Zod body, normalization,
      request hash, unit-of-work + executeIdempotent).
- [x] Corrected `executeIdempotent`; corrected `maskEmail`.
- [x] Split coverage gate: unit excludes repositories/routes/domain; integration
      config gates them.
- [x] `npm run check` + `npm run test:integration` (21/21) green.
- [x] Records updated; commit/push.

## Replacement And Deletion Map

| New | Superseded (deleted later) | Guard |
|---|---|---|
| submission route + repositories + command | `website/services/onboardingService.js` signup path (deleted BE-008c) | integration tests exercising every branch on real PG |

## RED Evidence

- Honest note: multiple real REDs were hit and fixed, proving the tests exercise
  the real database:
  1. `bigint` advisory-lock parameter — node-postgres does not serialize a JS
     `BigInt`; fixed by passing it as text cast to `bigint`.
  2. `idempotency_records_completion` CHECK (`completed_at >= created_at`) — the
     JS time captured before the transaction pre-dated the DB `created_at`
     default; fixed by letting `created_at`/`completed_at` both default to the
     transaction time.
  3. envelope `idempotencyReplay` was emitted as `false` on a fresh request;
     changed to include the flag only on a replay.

## Implementation And Decisions

- Repositories (factories over the typed pool): `applicationRepository`
  (`hasActiveConflict` probes active applications + existing users;
  `createSubmission`), `consentRepository.recordAcceptances` (authoritative
  document ids + consent-IP HMAC + truncated UA), `verificationTokenRepository`
  (hash only), `outboxRepository` (`occurred_at = now()` so it never post-dates
  `created_at`), `emailDeliveryRepository` (recipient envelope + HMAC + mask),
  `auditRepository`, and `idempotencyRepository` (non-blocking
  `pg_try_advisory_xact_lock` + completed-record store).
- `submitApplication`: resolves consents against the current documents (rejecting
  stale/unknown versions with `VALIDATION_FAILED`), no-ops on any active-identity
  conflict (uniform 202), otherwise atomically creates application + consents +
  token + delivery + outbox + audit. The raw token is carried transiently in the
  outbox payload for the worker (BE-012 hardens/sends).
- `executeIdempotent` corrected to check for a completed record before and after
  acquiring the advisory lock, so a completed request replays even after its
  transaction (and lock) ended; a hash mismatch is `IDEMPOTENCY_KEY_REUSED` and a
  concurrent in-flight request is `IDEMPOTENCY_IN_PROGRESS`.
- Coverage: `repositories/routes/domain` are PostgreSQL-bound; the unit config
  excludes them and the integration config now enforces its own 80% coverage gate
  over them (measured 99.48% stmts / 85.24% branch).
- Deferrals: cooldown resend + cross-match metric + race savepoint (BE-008b-3);
  verify-email + legacy deletion (BE-008c); SES sending + transient-token
  hardening (BE-012).

## GREEN Validation

| Gate | Command | Result |
|---|---|---|
| Unit check | `npm run check` | green (typecheck + lint + unit coverage + build + smoke) |
| Integration | `npm run test:integration` | 21/21 vs PostgreSQL 16; integration coverage gate green |

## Reviews

- Code + security (focused inline review): the public response is a uniform 202
  `{accepted:true}` for new and duplicate submissions alike; only the token hash
  is persisted; recipient PII is an AES-256-GCM envelope + keyed HMAC + masked
  display; consent evidence stores an IP HMAC, never the raw IP; the audit event
  is redacted; idempotency replays are byte-checked. Known deferral: the raw token
  is transiently in the outbox payload pending BE-012 hardening. No CRITICAL/HIGH.

## Metrics

- Source TS added: 6 repository files, `domain/onboarding/submitApplication.ts`,
  expanded route; corrected `idempotencyProtocol.ts`, `crypto/primitives.ts`.
- Test TS added/updated: submission integration tests (integration 16 -> 21);
  crypto/idempotency unit tests updated.
- Production JS/JSX deleted: 0 (deletion is BE-008c). Backend authored JS backlog
  unchanged at 83 files.

## Risk, Rollback, And Resume

- Residual risk: concurrent same-email race returns a retryable 500 (savepoint in
  BE-008b-3); cooldown resend not yet implemented; token transport unhardened.
- Rollback shape: revert the BE-008b-2 commit.
- Commit/push: conventional commit on `ts-migration/backend`; PR #1 updated.
- Exact next action: BE-008c — `POST /v1/applications/verify-email` (consume
  token, move to submitted) + delete `website/services/onboardingService.js`
  (first backend JS deletion), then BE-008b-3 refinements.

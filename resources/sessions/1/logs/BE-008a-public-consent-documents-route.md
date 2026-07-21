# BE-008a Phase Log: Public Consent-Documents Route

Status: `DONE`

## Objective And Dependency Closure

- Objective: `GET /v1/public/consent-documents` end-to-end with the first real
  repository implementation, proven on PostgreSQL 16.
- Dependencies: BE-006 (boundary), BE-007 (schema/seed/interfaces).
- Normative sources: `specifications/04` §3.1.
- Dominant risk: stale/duplicate documents or wrong digest.
- Intentional behavior change: none (new route; legacy public route untouched).

## Atomic Units

- [x] `src/repositories/consentRepository.ts` — `findCurrentDocuments`.
- [x] `src/routes/publicOnboardingRoutes.ts` — `GET /v1/public/consent-documents`.
- [x] Integration test: migrate + seed + inject GET; assert envelope + digests.
- [x] `npm run check` + `npm run test:integration` green (16/16 across 2 files).
- [x] Records updated; commit/push.

## Replacement And Deletion Map

| New | Superseded (deleted later) | Guard |
|---|---|---|
| `src/repositories/consentRepository.ts`, `src/routes/publicOnboardingRoutes.ts` | part of `website/services/onboardingService.js` + `website/routes/publicRoutes.js` (deleted at BE-008c/BE-013) | integration test hitting the route on real PG |

## Research And Reuse

- Reused the BE-006 boundary (`reply.sendData`, envelope), the BE-007f typed
  `Database`/`ConsentRepository` interface, and the BE-007g seed + BE-005 runner
  in the integration harness. The route registrar takes injected deps
  (`database`, `consentRepository`) so it is composed into `createApplication`.

## RED Evidence

- Honest note: the route/repository/test were authored together and validated
  GREEN. One real RED was hit and fixed: the integration `afterAll` closed the
  app and container but did not `await pool.end()`, so the container stop reset
  live pg connections and emitted an unhandled client error; adding `pool.end()`
  before `container.stop()` made the run clean.

## Implementation And Decisions

- `consentRepository.ts`: `createConsentRepository()` returns a
  `Pick<ConsentRepository, "findCurrentDocuments">`; `findCurrentDocuments`
  selects `consent_documents` where `retired_at IS NULL` and `kind IN (...)`,
  ordered by kind. The partial unique index guarantees at most one current
  document per kind. Remaining `ConsentRepository` methods land in BE-008b.
- `publicOnboardingRoutes.ts`: `registerPublicOnboardingRoutes(app, deps)`
  registers `GET /v1/public/consent-documents`, mapping each row to
  `{kind, version, publicPath, contentMarkdown, sha256}` where `sha256` is the
  lowercase hex of the stored `content_sha256` bytea, and replies via
  `reply.sendData`.
- Decisions/deferrals: the route is composed via `createApplication`'s
  `registerRoutes` seam. `POST /v1/applications` (BE-008b), verify-email +
  `onboardingService.js` deletion (BE-008c). Response Zod re-validation is
  deferred; the mapping is asserted by the integration test.

## GREEN Validation

| Gate | Command | Result |
|---|---|---|
| Unit check | `npm run check` | green (typecheck + lint + coverage + build + smoke) |
| Integration | `npm run test:integration` | 16/16 across 2 files; new route returns the seeded terms/privacy with matching SHA-256 digests |

## Reviews

- Code + security (focused inline review): only the authoritative current
  `consent_documents` row is returned; content, path, digest, and version come
  from the table, never from configuration or the request; the digest is
  recomputable hex of the stored bytes. No CRITICAL/HIGH/MEDIUM.

## Metrics

- Source TS added: `src/repositories/consentRepository.ts`,
  `src/routes/publicOnboardingRoutes.ts`.
- Test added: `test/integration/publicRoutes.integration.test.ts` (integration
  15 -> 16).
- Production JS/JSX deleted: 0 (onboarding JS deletion lands in BE-008c once the
  full public onboarding surface is replaced). Backend authored JS backlog
  unchanged at 83 files.

## Risk, Rollback, And Resume

- Residual risk: only the read route exists; submission/verification not yet
  replaced, so `onboardingService.js` cannot be deleted yet.
- Rollback shape: revert the BE-008a commit; remove the repository/route/test.
- Commit/push: conventional commit on `ts-migration/backend`; PR #1 updated.
- Exact next action: BE-008b — `POST /v1/applications` (submission with the
  duplicate/cooldown branches) + ApplicationRepository/ConsentRepository.record/
  VerificationTokenRepository/IdempotencyRepository/OutboxRepository/
  EmailDeliveryRepository/AuditRepository impls + the idempotency wiring.

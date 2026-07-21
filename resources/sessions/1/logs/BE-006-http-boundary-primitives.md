# BE-006 Phase Log: Fastify HTTP Boundary Primitives

Status: `DONE`

## Objective And Dependency Closure

- Objective: the typed HTTP boundary (envelope, request id, error catalog +
  mapping, body/media guards, Zod validation, idempotency orchestrator) that
  every `/v1` route batch consumes.
- Dependencies: CON-006, BE-003. Legacy transport deletion deferred to BE-019.
- Normative sources: `specifications/04` §2.2, §2.4, §3.
- Dominant risk: leaking internal text / wrong status.
- Intentional behavior change: `createApplication` error/not-found responses now
  use the canonical `{ok,data,error,meta}` envelope; `/health/live` stays the
  plain operational `{status:"ok"}`.

## Atomic Units

- [x] `src/http/errorCatalog.ts` — `ErrorCode`, status/retryable/message maps,
      `AppError`, internal->public mapping.
- [x] `src/http/envelope.ts` — success/error envelope builders + meta.
- [x] `src/http/validation.ts` — Zod parse helper -> `VALIDATION_FAILED` + fields.
- [x] `src/http/idempotencyProtocol.ts` — `Idempotency-Key` schema + pure
      orchestrator over `IdempotencyRepository`.
- [x] `src/http/boundary.ts` — Fastify wiring (request id, body/media guards,
      error/not-found renderer, `reply.sendData`); rewired `createApplication`.
- [x] Unit + inject tests; `npm run check` + `test:integration` (15/15) green.
- [x] Records updated; commit/push.

## Replacement And Deletion Map

| New | Superseded (deleted later) | Guard |
|---|---|---|
| `src/http/{errorCatalog,envelope,validation,idempotencyProtocol,boundary}.ts` | legacy `src/http/{errors,response,validate,idempotency,router}.js` (BE-019) | unit + Fastify `inject` boundary tests |

## Research And Reuse

- Reused the BE-003 typed runtime (`createApplication`, logger). The idempotency
  orchestrator consumes the BE-007f `IdempotencyRepository` interface. Error codes
  transcribed from spec 04 §2.4 (backend has no `@beonedge/contracts` dependency
  yet — CON-007 backlog — so the catalog is authored in the backend and will be
  reconciled when contracts are wired).

## RED Evidence

- Honest note: the modules and tests were authored together and validated GREEN.
  A real RED was hit and fixed during the batch: the new `errors.ts` /
  `idempotency.ts` filenames collided with the legacy `errors.js` /
  `idempotency.js` — tsc resolved the `.ts` but Vite/vitest resolved the physical
  legacy `.js`, so `AppError` was `undefined` at runtime and `error instanceof
  AppError` threw. Fixed by renaming the new modules to `errorCatalog.ts` /
  `idempotencyProtocol.ts` (no basename collision) until BE-019 deletes legacy.

## Implementation And Decisions

- `errorCatalog.ts`: the exact public `ErrorCode` union with fixed
  `ERROR_HTTP_STATUS`/`ERROR_RETRYABLE`/`ERROR_DEFAULT_MESSAGE` maps, the
  `INTERNAL_OUTCOME_TO_CODE` map + `mapInternalOutcome`, and `AppError`
  (carries code->status/retryable, optional safe message, `fields`,
  `retryAfterSeconds`).
- `envelope.ts`: `successEnvelope`/`errorEnvelope` producing the exact
  `{ok,data,error,meta}` shapes; meta is `{requestId, timestamp, idempotencyReplay?}`.
- `validation.ts`: `parseOrThrow(schema, input)` -> `VALIDATION_FAILED` with
  public dot-path `fields`; `zodFieldErrors` maps the root to `_root`.
- `idempotencyProtocol.ts`: `idempotencyKeySchema` (`^[A-Za-z0-9._:-]{8,128}$`)
  and `executeIdempotent` (lock-win -> execute+persist; byte-identical completed
  -> replay; hash mismatch -> `IDEMPOTENCY_KEY_REUSED`; no record ->
  `IDEMPOTENCY_IN_PROGRESS` + Retry-After 1) — pure over the repository interface.
- `boundary.ts`: `resolveRequestId` (valid incoming `X-Request-Id` UUID else fresh
  UUID), `registerHttpBoundary` (request-id + security-header hooks, envelope
  not-found + error renderers, `reply.sendData` decorator), `renderError` (maps
  `AppError`/Zod/Fastify framework/unknown to a stable code, redacts unexpected
  failures, never leaks internal text), and `MAX_JSON_BODY_BYTES = 65_536`.
- `runtime/application.ts`: instance now sets `bodyLimit` + routes framework
  errors through `renderError`, and installs the boundary; `/health/live` stays a
  plain operational response.
- Decisions/deferrals: legacy `src/http/*.js` + `router.js` remain until BE-019;
  SNS 256 KiB raw-body route + signature (BE-012/BE-014); cookie/CSRF/auth guards
  (BE-009/BE-010); the idempotency repository impl + transaction wiring land in
  BE-008.

## GREEN Validation

| Gate | Command | Result |
|---|---|---|
| Unit check | `npm run check` | green; new boundary modules 100% (idempotencyProtocol.ts 100% lines / 70% branch); 75 unit tests |
| Integration | `npm run test:integration` | 15/15 vs PostgreSQL 16 (unchanged; boundary is HTTP-layer) |

## Reviews

- Code + security (focused inline review): every failure maps to a stable
  `ErrorCode` with the correct status/retryable; `renderError` never serializes
  `error.message`/stack/PostgreSQL/provider text (uses catalog default messages
  and only public Zod field paths); unknown failures are redacted-logged as
  `UNEXPECTED_REQUEST_FAILURE` and returned as `INTERNAL_ERROR`; request ids are
  echoed only when a valid UUID; oversized bodies are rejected pre-parse.
  Inject tests confirm 404/413/415/409/200 + header behavior with no secret
  reflection. No CRITICAL/HIGH/MEDIUM.

## Metrics

- Source TS added: `errorCatalog.ts`, `envelope.ts`, `validation.ts`,
  `idempotencyProtocol.ts`, `boundary.ts`; `runtime/application.ts` rewired.
- Test TS added: 5 boundary test files; `runtime/application.test.ts` updated to
  the canonical envelope (unit suite 51 -> 75).
- Production JS/JSX deleted: 0 (legacy `http/*.js` deletion is BE-019). Backend
  authored JS backlog unchanged at 83 files.

## Risk, Rollback, And Resume

- Residual risk: the envelope change alters `createApplication` error responses;
  no non-cutover consumer depends on the old shape. Idempotency orchestrator is
  unproven end-to-end until BE-008 wires the real repository.
- Rollback shape: revert the BE-006 commit; `createApplication` returns to the
  prior inline handlers.
- Commit/push: conventional commit on `ts-migration/backend`; PR #1 updated.
- Exact next action: BE-008 — public consent/application/verification Fastify
  routes with the first repository implementations (ApplicationRepository,
  ConsentRepository, VerificationTokenRepository) + the first onboarding JS
  deletion.

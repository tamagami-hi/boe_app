# BE-006: Fastify HTTP Boundary Primitives

- Status: `DONE`
- Owner surface: `backend_controller/src/http/**` (new `.ts`), `src/runtime/application.ts`,
  tests. Legacy `src/http/*.js` + `src/router.js` are NOT deleted here (final
  transport deletion is BE-019, after all consumers move).
- Dependencies: GATE-02 partial, CON-006, BE-003 (typed runtime).
- Objective: the canonical typed HTTP boundary every `/v1` route batch consumes —
  the response envelope, request-id resolution, the stable error catalog +
  internal->public mapping, JSON body-size + media-type enforcement, Zod
  input/output validation, and the DB-backed idempotency orchestrator.
- Normative sources: `specifications/04` §2.2 (envelope), §2.4 (stable errors +
  internal->public map), §3 (`MAX_JSON_BODY_BYTES = 65_536`, 413/415, route
  inventory, `Idempotency-Key` scalar).
- Dominant risk: leaking internal/PostgreSQL text or the wrong HTTP status. Every
  code maps to an exact status/retryable pair; the error renderer redacts and
  maps framework/Zod/unknown errors; unit + inject tests assert the envelope,
  status, headers, and that no internal text escapes.
- Production replacement closure: `src/http/{errors,envelope,validation,idempotency,boundary}.ts`
  wired into `createApplication`. Authoritative typed boundary; the legacy
  `errors.js`/`router.js`/`http/*.js` remain until BE-019.
- Scope boundary / deferrals: SNS 256 KiB raw-body route + signature validation
  (BE-012/BE-014); cookie/CSRF/auth guards (BE-009/BE-010); per-route rate-limit
  policy execution (uses `RateLimitRepository`, wired in route batches). The
  idempotency orchestrator here is pure logic over the `IdempotencyRepository`
  interface; its real repository impl + transaction wiring lands in BE-008.
- Exact JS/JSX deletion target: none (foundation; deletions begin BE-008).
- Capability eval: envelope builders produce the exact `{ok,data,error,meta}`
  shapes; `AppError` renders its mapped status/retryable/fields; a valid incoming
  `X-Request-Id` is echoed and an invalid one is replaced with a UUID; an
  oversized body -> 413, a wrong media type -> 415, a Zod failure -> 400 with
  public field paths; unknown/PostgreSQL errors -> 500 with no leaked text; the
  idempotency orchestrator replays a matching completed record, rejects a hash
  mismatch (`IDEMPOTENCY_KEY_REUSED`), and reports an in-progress lock
  (`IDEMPOTENCY_IN_PROGRESS`).
- Coverage/build gates: unit `npm run check` green (incl. Fastify `inject`
  boundary tests); `npm run test:integration` still green.
- Required reviews: general + security (no secret/PII/DB text in envelopes or
  logs; safe messages only).
- Rollback shape: revert the BE-006 commit; `createApplication` returns to the
  prior inline handlers.
- Done condition: check + integration green; records updated; commit pushed; PR
  updated; Legacy hash `d5fd7425...`.
- Phase log: [BE-006 log](../logs/BE-006-http-boundary-primitives.md)

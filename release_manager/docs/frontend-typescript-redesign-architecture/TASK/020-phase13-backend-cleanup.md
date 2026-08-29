# 020 — Phase 13 backend cleanup

Partially closes known gap 6 from `README.md`. Decisions: D-046 to D-051. Log: Entry 024.

Touches `backend_controller/` only, plus one gitignored file under `.claude/`.

## What this was

Doc 10's "Phase 13 — Backend cleanup" section, ten named items. The brief was explicit that doc 10
is authority for *what to look at* and not for whether each item is dead — every item had to be
proven dead by grep across `src/`, `test/`, `scripts/`, `db/migrations/`, the guard tests,
`package.json`, the compose files and `frontend_stack_ts/` before removal, and anything whose removal
would change an endpoint's availability had to be reported instead.

That distinction turned out to be the whole task. **Four of the ten items are not dead**, and one of
them — `optionalIdempotencyKey` — sits in doc 10's table headed "safe to remove — **proven dead**,
with the evidence". Acting on that table without checking would have broken three admin write paths
and deleted a live admin endpoint.

## Result

| # | Item | Verdict |
|---|---|---|
| 1 | `src/auth/sessionTokens.ts` + test | **REMOVED** |
| 2 | Three duplicate `requireIdempotencyKey` bodies | **CONSOLIDATED** onto `adminRouteKit.ts` |
| 3 | `optionalIdempotencyKey` | **KEPT** — three live callers (D-046) |
| 4 | `PUT` in `ALLOWED_METHODS` | **REMOVED** |
| 5 | `adminFundGrowthPreviewRoutes.ts` | **KEPT** — live endpoint, live screen (D-049) |
| 6 | `user_credentials.locked_until` in `db/types.ts` | **REMOVED** from the type; column kept (D-051) |
| 7 | `providerEventInboxRepository.claimReceived` | **REMOVED**, with `.reschedule` and `.deadLetter` (D-050) |
| 8 | Refund machinery | **KEPT** — shipped admin screen reads it (D-048) |
| 9 | `mandateReconciliationWorker` | **KEPT** — already wired, just co-hosted (D-047) |
| 10 | `project_razorpay_test_integration.md` + `MEMORY.md` | **REMOVED** / rewritten |

## 1. The four items doc 10 got wrong

### `optionalIdempotencyKey` — listed as unused, has three callers

```
routes/adminOversightRoutes.ts:148   const key = optionalIdempotencyKey(request)
routes/adminContentRoutes.ts:224     const key = optionalIdempotencyKey(request)
routes/adminCatalogRoutes.ts:151     const key = optionalIdempotencyKey(request)
```

It is not a redundant twin of `requireIdempotencyKey`. Those three routes honour a key if one is
sent and proceed without one; the financial writes reject the request outright. Two different
policies, two helpers.

### `adminFundGrowthPreviewRoutes.ts` — a live endpoint the admin console calls

```
runtime/composition.ts:463                        registerAdminFundGrowthPreviewRoutes(application, adminAumDeps)
test/integration/adminAum.integration.test.ts:189 registerAdminFundGrowthPreviewRoutes(instance, aumDeps)
features/admin/fund-aum/CollectiveAumGrowthScreen.tsx:52
  (await api.request(previewAdminCollectiveAumGrowth, { body })).data
```

It serves `POST /v1/admin/aum/growth/collective/preview`, the only producer of the `basisHash` that
the collective commit endpoint refuses to write without. Deleting it makes the commit uncallable.

The split module is real awkwardness — it exists because the §4.1 dependency-wall guard greps
`aum`-pathed modules for the substring `review`, and the mandated route literal contains
`p**review**`. The fix is `\breview\b` in the guard, then fold the handler back. See D-049 for why
that is not this change.

### `mandateReconciliationWorker` — wired, not orphaned

Doc 10: "No dedicated entrypoint, no compose service, and no health check". All three true. The
inference that it therefore does not run is not:

```
runtime/composition.ts:698 (inside composePaymentReconciliationWorker.runOnce)
  if (recurringGateway !== null) {
    await runMandateReconciliationPass({ … })
  }
```

`npm run worker:payments` → `src/paymentReconciliationEntrypoint.ts` →
`composePaymentReconciliationWorker(...).runOnce()` → the payment pass, then the mandate pass, in one
process, under one `payment_reconciliation` heartbeat. The genuine defect is that the mandate pass's
summary is discarded and its failures are attributed to payments — an observability gap, not a
wiring one. D-047.

### The refund machinery — one missing piece, nine-tenths live

`refundRepository.create` really has no production caller. Everything else does:
`adminFundReceiptRoutes.ts` (list, requeue, reconcile-now), `paymentReconciliationWorker.ts`
(`lockDueRefunds` and the state machine), `domain/payments/applyRefundOutcome.ts` (PhonePe
callbacks), and `features/admin/refunds/RefundQueueScreen.tsx` behind `refunds.write`. So the
question is doc 10's own **D6** — is refunding a product feature — and not a cleanup question. D-048.

## 2. What was removed

### `src/auth/sessionTokens.ts`

Only consumer was `sessionTokens.test.ts`. The live paths use `auth/refreshDerivation.ts::hashToken`
(imported by `domain/auth/webAuth.ts` and `domain/auth/nativeAuth.ts`). Its four environment
variables — `CRYPTO_REFRESH_TOKEN_KEY`, `CRYPTO_REFRESH_TOKEN_KEY_VERSION`, `CRYPTO_CSRF_TOKEN_KEY`,
`CRYPTO_CSRF_TOKEN_KEY_VERSION` — appear nowhere else in the repository: not in `.env.example`, not
in `.env.production.example`, not in `runtime/composition.ts`, not in
`scripts/generate-deploy-secrets.ts`. A keyed-HMAC design that was never switched on.

Both paths went into `legacy-deletion.guard.test.ts` so it cannot return, and that file's `BE-009d`
comment — which named `sessionTokens.ts` as the replacement for the deleted `security/tokens.js` —
now names `refreshDerivation.ts`.

The one thing worth double-checking before deleting this, given a cookie-session change is in flight
in the same repository: a browser cookie session needs a synchroniser CSRF token, and this module
generates one. But the web CSRF path already exists and already ships — `routes/webAuthRoutes.ts`
handles `GET /v1/auth/web/csrf`, `domain/auth/webAuth.ts:381-487` compares presented tokens with
`bytesEqual(hashToken(...))`, and `authSessionRepository.rotateWebCsrf` persists them. It hashes
through `refreshDerivation`, not through this module. Nothing in flight needs it.

### The provider-event inbox drain

The brief named `claimReceived`. Removing it alone would have left `.reschedule` and `.deadLetter`
with no caller *and* no reachable precondition — `claimReceived` was the only writer of
`state = 'processing'`, which both of them require. All three had zero consumers; all three went.

The schema was not touched: `locked_at`, `locked_by`, `attempt_count`, `available_at`,
`last_error_code` and the `processing` / `dead_lettered` states all remain, and no migration was
written. The module header now says out loud what the code does — webhook processing is synchronous
inside the request, and a callback whose processing fails is recovered only by PhonePe redelivery or
by reconciliation polling. D-050.

### `PUT` from the CORS allowed-methods list

No route registers it. The only method registrations under `src/routes/**` are
`application.{get,post,patch,delete}`; the only method literals anywhere in `src/` are `"GET"`,
`"POST"`, `"OPTIONS"`. `cors.test.ts:71` asserts `GET, POST, PATCH, DELETE` and never mentions
`PUT`, so the test did not have to change. The behaviour change is limited to a preflight for a
method that would have 404'd on arrival.

### `user_credentials.locked_until` from `db/types.ts`

Type-level only. No migration, and the column stays. Its siblings `failed_attempt_count` and
`failed_attempt_window_started_at` are equally dead in code and were deliberately left in the type —
they are coupled by the `user_credentials_window` CHECK, migration `026:38-41` records their absence
as a deferral rather than an oversight, and dropping them is one reviewed migration. D-051 states the
resulting inconsistency rather than hiding it.

### `.claude/agent-memory/node-backend-engineer/project_razorpay_test_integration.md`

It instructed any agent loading it to wrap new financial POSTs in `withIdempotency(...)` from
`src/http/idempotency.js` — a file `legacy-deletion.guard.test.ts` asserts stays deleted — on the
grounds that "Razorpay test orders are the real (not stub) payment integration target". The provider
is PhonePe and the mechanism is `http/idempotencyProtocol.ts::executeIdempotent`. It was the only
entry `MEMORY.md` indexed, so `MEMORY.md` is now an empty index that names the real mechanism.
`.claude/` is gitignored, so this is a working-tree deletion.

## 3. What was consolidated

Four byte-equivalent copies of the same helper existed. `adminRouteKit.ts:37` keeps the one; the
three locals at `clientAutoPaySipRoutes.ts:72`, `clientOrderRoutes.ts:76` and
`adminIdentityRoutes.ts:129` are gone, replaced by an import. Each file also dropped its now-unused
`idempotencyKeySchema` import.

Verified identical before doing it — same header read, same array-first coercion, same
`idempotencyKeySchema.safeParse`, same `AppError("VALIDATION_FAILED")` with the same
`fields["idempotency-key"]` message. The only differences between the four were line wrapping.

Two guards had to be checked first:

- `investment-architecture.guard.test.ts:182` asserts the literal text `requireIdempotencyKey`
  appears in `adminAumRoutes.ts` and `adminClientGrowthRoutes.ts`. Neither is one of the three, and
  the identifier survives in all three regardless.
- The §4.1 dependency wall greps each module's source for forbidden domain words. The text this
  change adds is `"./adminRouteKit.js"`, which matches none of
  `allocation|clientValue|client_value|aum|growth|payment|review`.

Two client route modules now import from a file called `adminRouteKit`, which reads wrong. Renaming
it to something neutral is a follow-up; it is imported by ten admin route modules and
`routes/fundProjection.ts`, and doing it inside a deletion pass would bury the rename.

## 4. Verification

**TESTED**, in `backend_controller/`:

- `npx tsc -p tsconfig.json --noEmit` — clean. `include` covers `scripts/**`, `src/**`, `test/**`
  and both vitest configs, so `test/integration/**` still compiles.
- `npx eslint .` — clean. Re-run over the seven touched files with
  `--rule '{"@typescript-eslint/no-unused-vars":"error"}'` to prove no deletion orphaned an import.
- `npx vitest run --config vitest.config.ts` — 75 files, 724 tests, pass. The config's `include` is
  `src/**/*.test.ts`, so integration tests are already out of scope and no exclude flag was needed.
  The drop from 76/726 is exactly `sessionTokens.test.ts`.
- `npm run build` — clean.

The clean `tsc` and `build` runs were taken before the client-cookie-session work landed in the same
working tree. On the tree as left, `tsc` reports errors in `domain/auth/webAuth.ts` and
`runtime/composition.ts` — both mid-edit by that work, neither touched here, and no file this task
changed appears in the error list. `eslint .` and the 724 unit tests still pass on the tree as left.

**UNVERIFIED.** Nothing was executed against PostgreSQL or over HTTP. The consolidation is argued
from reading four copies of eight lines; no request has passed an `Idempotency-Key` — or omitted one
— through the shared helper on the three affected routes. Entry 024 carries the exact `curl` sequence
to run on the VPS after deploying, covering the missing-key rejection, the replay on
`POST /v1/client/orders`, and the preflight without `PUT`.

## 5. The one risk this created

`vitest.config.ts` gates on 80% coverage across all four metrics. `sessionTokens.ts` was fully
covered by the test that was its only consumer, so deleting the pair removed 11 branches out of 11
covered:

```
before   branches 1142/1424 = 80.19%
after    branches 1131/1413 = 80.04%
```

Measured, not inferred — the deleted files were restored from `HEAD`, coverage re-run, and removed
again. `npm run check` passes with roughly one branch of headroom. One new uncovered branch anywhere
in `src/` outside the `repositories/`, `routes/` and `domain/` coverage excludes now fails it.

The answer is not to keep dead code. The threshold has been riding on a well-tested dead module while
`runtime/composition.ts` sits at 72.16% and `providers/phonepe/gatewayFailure.ts` at 69.35%. Whoever
next touches either should expect to add tests before the gate lets them through.

## 6. Also found

`backend_controller/.env.legacy-backup`, which doc 10 lists for deletion or Razorpay key rotation,
**does not exist**. The env files present are `.env`, `.env.example`, `.env.local-e2e` and
`.env.production.example`. If those keys were ever real they are still worth rotating, which is not a
code change.

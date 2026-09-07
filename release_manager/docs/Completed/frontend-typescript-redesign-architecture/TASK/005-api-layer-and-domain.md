# TASK 005 — Blocker re-verification, contract parity, and the real Phase 1 completion

Date: 2026-08-28
Log entries: [010](../LOGS/implementation_log.md), [011](../LOGS/implementation_log.md), [012](../LOGS/implementation_log.md)
Decisions: [D-020](../LOGS/risk_and_decision.md#d-020) · [D-021](../LOGS/risk_and_decision.md#d-021) · [D-022](../LOGS/risk_and_decision.md#d-022) · [D-023](../LOGS/risk_and_decision.md#d-023)

## Why this task existed

Two reasons. First, a second agent had been landing the backend contract slice
(`BACKEND_CONTRACT_HANDOFF_2026-08-28.md`) and the blocker table needed re-checking against
what actually reached the tree. Second, Entry 008 declared Phase 1 complete when the API layer
and two thirds of `domain/` had not been written — including the two test files doc 12 justifies
as duplicate-payment protection.

## What was done

### 1 · Blocker re-verification

Six of seven blockers are closed. B2 stays partial by design under D-001.

The interesting part was **not** taking Entry 002's B4 claim at face value. Entry 002 said the
drift checker now covers `frontend_stack_ts`; that had never been exercised, because the tree
contained no `/v1` literals, so "no drift" and "not scanned" were indistinguishable. Proved it by
planting a temporary module with a known-bad path and confirming the checker named it, then
confirming a real baseline path in the same file was classified as a known gap rather than new
drift. Also read the walker: `.ts`/`.tsx` are in `SOURCE_EXTENSIONS`, and `.test`/`.spec` files are
excluded — which is why the fake operation descriptors in `http.test.ts` do not register.

Also worth recording: an earlier pass in this session measured `backend_controller` at 666 tests
and **79.78%** branch coverage, i.e. failing its own 80% gate. The other agent closed that with two
new route test suites; it is now 676 tests at 80.04% and exits 0.

### 2 · Error-code parity, inverted and restored

Entry 003 brought contracts to 24 codes to match the backend. The other agent then removed
`MOBILE_CHECKOUT_DISABLED` from the backend when AutoPay moved to hosted redirect — it existed only
to signal "AutoPay disabled" on the native-SDK path. Parity inverted: backend 23, contracts 24, and
`generate:check` was baking a code into the OpenAPI spec that the backend can no longer return.

Removed it from `errors.ts` and the `errors.test.ts` mirror, regenerated. Set difference now proves
identical 23-code sets.

### 3 · Phase 1, actually finished

`src/lib/assertNever.ts`, `src/domain/{status,dates,permissions}.ts`,
`src/api/{errors,envelope,cursor,idempotency,http}.ts`,
`src/api/session/{scope,tokenStore,refresh}.ts`, `scripts/generate-api-client.mjs`,
`src/api/generated/operations.ts`, and the two justified test files.

## Where the architecture docs were wrong

Four corrections, all found by reading source rather than the docs. These matter because each would
have produced broken code if taken on trust.

| Doc | Claim | Reality |
|---|---|---|
| 07 §API layer | `success: { status: 201, schema: OrderCreated }` reads as a data schema | `success.schema` is the **full envelope** from `createSuccessEnvelopeSchema`. A transport built on the doc's reading fails validation on every response (D-023) |
| 10 Phase 1, 11 tokens | Port `design-tokens/src/kit.css` | `kit.css` is a 3-line import shim over 178 lines of global `be-*` component classes — the vocabulary CSS Modules exists to eliminate. The element reset worth keeping is already in `src/index.css` (D-021) |
| 09 §StatusBadge | `payment` and `order` are badge domains | Clients only ever receive the 7-value projected `ClientInvestmentStatus`; raw `OrderState`/`PaymentState` are admin-only |
| 02 §Terminology, 10 Phase 4 | Email verification vocabulary conflict "to resolve", `NEEDS RUNTIME VERIFICATION` | Resolved. `EmailVerificationState` is `not_started \| pending \| verified` and migration 045 landed |

Additionally, docs 01, 04, 10 and 11 still describe the **native PhonePe SDK AutoPay rail** as live
(`createMandateSdkOrder`, `checkout:{type:"phonepe_sdk", token, merchantId, environment}`, porting
`phonePeMobileCheckout.js` to `platform/phonePeMandateCheckout.ts`, and
`check-phonepe-native-target.mjs` as a Phase 11 gate). All of that is gone from the tree. These are
**not yet corrected** and are the highest-value stale claims remaining, because they will mislead
Phase 8 and Phase 11 directly.

## Verification

TESTED: `npm run check` exit 0 in all three projects except `contracts`, whose only failure is
`generate:check` awaiting a commit of the regenerated artefacts. `frontend_stack_ts` is at
**66 tests** across 4 files, up from 27. `build:client` passes both android and boot gates at
373,094 bytes. Drift checker clean on default roots. Three `release_manager` shell tests pass.

UNVERIFIED, and this is the important part: **no request has ever been sent to a real backend.**
Every transport behaviour is proven against an injected `fetch` double, which cannot catch a header
the backend rejects, a cookie the browser refuses, or a CORS preflight failure. The container was
never built, no dev server was started, nothing ran on a device, and the `frontend-ts` CI job has
still never executed.

## Next

1. Correct the four stale AutoPay/native-plugin claims in docs 01, 04, 10, 11.
2. Commit the regenerated `packages/contracts/generated/openapi-v1.*` to green the contracts gate —
   deliberately deferred here because the working tree also holds the other agent's in-flight slice.
3. Phase 2: shells, `buildRouter` generated from the manifest, the six providers in their contracted
   order, `resolveDestination` with all refusal cases, and `NativeBackCoordinator` with
   `onTransactionalBack` **actually wired** — the legacy prop was never passed, so Back rule 2 has
   never fired.

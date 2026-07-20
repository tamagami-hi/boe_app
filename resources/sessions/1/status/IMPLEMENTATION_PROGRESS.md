# Rearchitecture Implementation Progress

## Tracking Rules

- Implement one bounded slice at a time; do not mark adjacent work active.
- Record test-first RED evidence before implementation and GREEN evidence after.
- A slice completes only after its focused tests, coverage, build, smoke, and
  required reviews pass.
- Update this file in the same commit as the slice it describes.

## Direct Replacement Directive

The user clarified the implementation target after commit `45fc7f7`: this is a
direct JavaScript-to-TypeScript replacement, not a compatibility exercise.
The new TypeScript backend and frontend implementations become authoritative as
they are introduced; the old JavaScript application does not have to remain
runnable between batches. Every replacement batch must identify and delete all
superseded `.js`/`.jsx` production and test files in the same commit. Untouched
legacy files may remain only as explicitly unmigrated inventory; they are not
compiled, supported, or acceptance-tested through a mixed-runtime bridge.

Database forward-migration safety and supported external `/v1`/APK contracts
remain governed by `02`-`04`; this directive removes source-runtime coexistence,
not data integrity or public compatibility requirements. Progress reports must
separately state production TypeScript added, TypeScript tests added, and legacy
JavaScript/JSX removed. Completion requires replacement and deletion across the
backend, landing, admin, client, shared frontend, and operational entrypoints.

## Overall Status

| Phase | Status | Current boundary |
|---|---|---|
| Phase 0: planning and architecture | Complete | Approved in commit `ec07d21` |
| Phase 2: test and TypeScript foundation | In progress | Contract kernels plus authoritative TypeScript/Fastify liveness runtime; 0/7 full Phase 2 acceptance gates complete |
| Phases 3-10 | Not started | Blocked by earlier phase gates |

## Completed Slice: Graceful API Lifecycle (BE-002)

**Status:** Complete (branch `dev`, PR to `main`).

**Scope:** Add bounded, tested graceful shutdown to the authoritative
TypeScript/Fastify runtime. New `src/runtime/shutdown.ts` provides
`performGracefulShutdown` (races Fastify `close()` against an unref'd, always
cleared deadline; resolves `closed`/`timeout`/`error`) and
`registerGracefulShutdown` (idempotent single-drain `SIGTERM`/`SIGINT` handlers,
exit `0` clean / `1` timeout|error, injectable `target`/`exit`, returns an
unregister). `server.ts` wires it after start. `scripts/smoke-entrypoint.ts` now
asserts a graceful exit code `0` on `SIGTERM` in both source and dist modes.

**Explicitly out of scope:** stateful routes, PostgreSQL, workers, providers,
config closure, and any JS deletion.

| Gate | Status | Evidence |
|---|---|---|
| Tests before implementation | Complete | `shutdown.test.ts` RED on missing module; smoke RED because the un-wired server exited by `SIGTERM` signal, not code 0 |
| Implementation GREEN | Complete | 9 shutdown tests pass; full suite 27/27 |
| Coverage >=80% (>=90% lifecycle branch) | Complete | 93.69% stmts / 91.89% branch / 90.9% funcs; `shutdown.ts` 97.18% stmts / 95% branch |
| Typecheck/lint/build/smoke | Complete | Strict typecheck, typed ESLint, build, and source+dist smoke (SIGTERM -> exit 0) pass on Node 22.22.3 / npm 11.16.0 |
| Reviews | Complete | semantic_reviewer: no CRITICAL/HIGH; MEDIUM (drain proof) fixed with a deterministic drain-wait test; two LOW addressed/tracked |
| JS deletion | N/A | Additive; backend backlog unchanged at 89 files / 12,600 lines |
| Commit/push | Complete | Conventional commit on `dev`; PR opened to `main` |

**Tracked LOW:** the startup `.catch` could mislabel a synchronous
`registerGracefulShutdown` throw as `BACKEND_STARTUP_FAILURE`; latent only.

## Completed Slice: Backend TypeScript Runtime Reset And Liveness

**Status:** Complete

**Scope:** Replace the backend production entrypoint with strict TypeScript and
Fastify, expose only database-independent `GET /health/live`, establish exact
Node/npm/tooling pins, validate environment input, use secret-safe structured
logging, build emitted-only production output, and replace the server Docker
runtime. The superseded server, server test, and development launcher JavaScript
files are deleted in this batch.

**Explicitly out of scope:** legacy business routes, PostgreSQL readiness,
repositories/migrations, authentication/authorization, providers, workers,
landing BFF, frontend consumers, and release publication. Unreplaced JavaScript
is unreachable and excluded from the authoritative build; it is deleted only
with its real TypeScript replacement.

| Gate | Status | Evidence |
|---|---|---|
| Research and reuse | Complete | Repository/GitHub/registry and primary Fastify, Node, TypeScript, Pino, and Zod documentation reviewed; exact Fastify 5.10.0 and approved Phase 2 toolchain selected |
| Tests before implementation | Complete | Missing-module/deletion RED failed 5 suites; deployment-boundary RED failed on the old Docker/launcher; review regressions failed for implicit HEAD, malformed URL reflection, shallow nested redaction, loopback binding, digest pins, and missing real-entrypoint smoke before fixes |
| Runtime replacement | Complete | Strict `allowJs:false` NodeNext build; Fastify-only `server.ts`; exact GET-only liveness; safe 400/404/500 boundaries; Zod environment parsing; Pino redaction; no legacy alias/router/DB/auth imports |
| JavaScript deletion | Complete | Deleted 164 production/operational JS lines (`src/server.js` 40, `scripts/start-dev.js` 124) plus 47 JS test lines (`src/server.test.js`) |
| TypeScript added | Complete | 209 production runtime lines, 88 operational smoke lines, 271 TypeScript test lines, and 22 TypeScript tooling-config lines |
| Node 22 acceptance | Complete | Node 22.20.0/npm 11.16.0: strict typecheck, typed lint, 18/18 tests, 95.17% statements/lines, 88.88% branches, 100% functions, build, and real source/emitted CLI smokes passed |
| Container and dependency acceptance | Complete | Digest-pinned image built; non-root container reached Docker healthy and returned exact `{status:"ok"}`; production audit found zero vulnerabilities |
| Regression and reviews | Complete | Contracts remained 113/113 with 100% coverage; code/TypeScript and security re-reviews reported no remaining CRITICAL, HIGH, or MEDIUM findings |
| Commit | Complete | `9e884ad` (`feat: replace backend server runtime with TypeScript`), pushed to `origin/main` |

**Remaining legacy inventory after this slice:** 85 production/operational JS
files and 4 JS tests, 12,600 lines total across `backend_controller/src` and
`backend_controller/scripts`. These are migration backlog, not supported
runtime code. Docker `dist` contains only the four migrated production modules.

**Tracked LOW:** graceful SIGTERM/SIGINT draining must land before stateful
routes or workers. The liveness-only server currently exits through the process
signal default. Release publication remains blocked even though the image is
buildable and healthy.

## Completed Slice: Native Authentication Operation Contracts

**Status:** Complete

**Scope:** Add strict native login, deterministic refresh, and naturally
idempotent logout wire contracts and immutable descriptors; expose root and
`./native-auth` package surfaces; and extract route-neutral native schemas
without changing activation compatibility exports.

**Explicitly out of scope:** password hashing/HIBP/timing/lockout, database
sessions and same-device locking, JWT verification/claims, refresh HMAC and
30-second replay/family revocation, logout execution, raw header/cookie
enforcement, header/body app-version equality, rate-limit implementation,
secure storage/single-flight/client retry, routers, OpenAPI/client generation,
consumer manifests, CI, Docker, and frontend/Android changes.

| Gate | Status | Evidence |
|---|---|---|
| Approved-plan review | Complete | Planner, factual extractor, TDD/security guide, and conflict-resolution review fixed the three routes, neutral native ownership, credential/idempotency/cache policies, error arrays, exclusions, and post-verification race boundary |
| Research and reuse check | Complete | Normative `01`-`05`, current package schemas, repository patterns, and prior authenticated reuse research were reviewed; no dependency or competing contract source was added |
| Tests written before implementation | Complete | `operations/native-auth.test.ts` preceded `operations/native-auth.ts`; review regressions for approved operation IDs, neutral token ownership, idempotency discrimination, exact request inference, and JSON Schema coverage preceded their fixes |
| RED observed | Complete | Initial focused run failed on missing `./native-auth.js`; review RED then failed operation-ID assertions and typecheck because native refresh incorrectly accepted generic stored idempotency |
| Minimal implementation | Complete | Three strict route contracts/descriptors, one frozen registry, internal route-neutral native schemas, preserved activation schema identities, closed combined security/idempotency policy, and root/`./native-auth` exports only |
| Unit tests GREEN | Complete | Node 22.20.0/npm 11.16.0 Vitest 3.2.6: 113/113 package tests passed, including 13 focused native-auth tests |
| Coverage >=80% on all four metrics | Complete | 100% statements, branches, functions, and lines across every authored contract source file |
| Typecheck/lint/build/import smoke | Complete | Clean `npm ci`; strict typecheck, typed ESLint, declaration/ESM build, root/subpath export smoke, and 37-entry package dry-run passed under Node 22.20.0/npm 11.16.0 |
| Security and privacy checks | Complete | Zero-vulnerability audit; closed body-only/bearer credential policies; route-wide no-store; strict secret-safe inputs/minimal outputs; enumeration-safe login errors; deterministic refresh and natural logout semantics without generic secret replay storage |
| Focused reviews | Complete | Initial reviews found operation-ID/token-ownership compatibility, idempotency-discrimination, test-coverage, and enumeration-documentation issues; regression-first fixes were re-reviewed with no remaining CRITICAL, HIGH, or MEDIUM findings |
| Commit | Complete | Recorded by the containing `feat: add native authentication contracts` commit |

**Derived contract decisions:** operation IDs are `nativeLogin`,
`refreshNativeSession`, and `logoutNativeSession`. Login credential/principal
failures always use `INVALID_CREDENTIALS`; `STATE_CONFLICT` is reachable only
after successful verification and active-principal determination when the
single retry of the same-device resource race is exhausted. Refresh uses
`SESSION_INVALID` and `deterministic-rotation`; logout uses descriptor-only
bearer authority plus a strict refresh-token body and `naturally-idempotent`.
Normalized compatibility DTOs never contain cookie or Authorization values.

**Tracked LOW:** precise const-preserved descriptors still expand in emitted
declarations. The current operation declarations total 1,623 lines/66,535
bytes: public 641/26,802; native-auth 586/23,750; activation 260/10,803;
native shared 76/2,917; descriptor 60/2,263. Exact route types remain correct;
compaction stays deferred to deterministic generation.

## Completed Slice: Native-Only Activation Operation Contract

**Status:** Complete

**Scope:** Add the strict native-only, single-use activation request, response,
and immutable operation descriptor; expose root and `./activation` package
surfaces; and extract the operation constructor shared with public onboarding.

**Explicitly out of scope:** activation persistence and atomic state changes,
password hashing, session/JWT/refresh implementation, raw-header enforcement,
header/body app-version equality, device attestation, browser fallback exchange,
backend/router/client wiring, OpenAPI generation, consumer manifests, CI,
Docker, release tooling, and frontend changes.

| Gate | Status | Evidence |
|---|---|---|
| Approved-plan review | Complete | Planner, factual extractor, TDD guide, and security reviewer selected the single activation route plus the now-justified shared descriptor extraction and fixed the route/body/header/response/error boundary |
| Research and reuse check | Complete | Repository and authenticated GitHub searches found generic Zod descriptor patterns but no maintained implementation matching the native-only token, response, and error policy; existing Zod/scalar/envelope kernels were reused |
| Tests written before implementation | Complete | `operations/activation.test.ts` preceded `operations/activation.ts`; review regressions for closed auth/status policy, route-wide no-store, explicit credential transport, canonical phone masking, secret-safe issues, and exact request inference preceded their fixes |
| RED observed | Complete | Initial focused run failed on missing `./activation.js`; review RED then failed runtime policy assertions and typecheck for widened `authChannel`/status plus missing credential and masked-phone contracts |
| Minimal implementation | Complete | One activation operation, strict schemas, canonical masked-phone output, frozen registry, root/`./activation` exports, and internal immutable descriptor helper; public descriptors gained only explicit credential-policy metadata |
| Unit tests GREEN | Complete | Node 22.20.0/npm 11.16.0 Vitest 3.2.6: 100/100 full package tests passed, including 16 focused activation and 24 public-operation tests |
| Coverage >=80% on all four metrics | Complete | 100% statements, branches, functions, and lines across every authored contract source file |
| Typecheck/lint/build/import smoke | Complete | Clean `npm ci`; strict typecheck, typed ESLint, declaration/ESM build, root/subpath export smoke, and package dry-run passed under Node 22.20.0/npm 11.16.0 |
| Security and privacy checks | Complete | Zero-vulnerability audit; strict body/header/device/output objects; token/password issue serialization excludes inputs; cookie/Authorization/browser exchange is forbidden by closed `native-body-token-only` policy; all auth responses are `no-store`; raw phone output is rejected |
| Focused reviews | Complete | Initial general/security reviews blocked broad auth/status types, success-only caching, implicit credential transport, and unconstrained phone masking; regression-first fixes were re-reviewed with no remaining CRITICAL, HIGH, or MEDIUM findings |
| Commit | Complete | Recorded by the containing `feat: add native activation contract` commit |

**Derived contract decisions:** exact operation ID/error list and descriptor
policy fields were absent from route snippets. The reviewed operation ID is
`completeActivation`; credential policy is `native-body-token-only`; cache
policy applies to every response; and `phoneMasked` has one display-only form
(`+` country code, six `*`, final four digits). Compatibility headers remain
non-authoritative. Header/body app-version equality and raw-header rejection
remain Phase 4 transport gates.

**Tracked LOW:** source-level descriptor logic is now shared, but const-preserved
inference still expands in emitted declarations. Compared with the prior public
declaration (635 lines/26,542 bytes), the extraction alone caused no reduction;
the explicit credential field makes the current file 641 lines/26,802 bytes.
Activation emits 277 lines/11,380 bytes. Keep exact request-key inference and
address declaration compaction in the deterministic-generation batch.

## Completed Slice: Public Onboarding Operation Contracts

**Status:** Complete

**Scope:** Add strict Zod wire schemas and deeply immutable descriptors for
the exact three public onboarding routes: current consent documents,
enumeration-safe application submission, and single-use email verification.
Expose the group through the package root and the public-only subpath.

**Explicitly out of scope:** admin/activation/auth/provider operations, OpenAPI
generation packages or artifacts, generated clients, backend/router/BFF
wiring, Markdown rendering, database/idempotency/rate-limit implementation,
consumer manifests, CI, Docker, release tooling, and frontend changes.

| Gate | Status | Evidence |
|---|---|---|
| Approved-plan review | Complete | Planner, factual extractor, and TDD guide selected the three-route public group as one cohesive operation batch and fixed exact IDs, route metadata, derived error lists, and exclusions |
| GitHub reuse search | Complete | Authenticated searches for Zod operation descriptors and consent contracts found generic examples but no maintained implementation matching this route/error/idempotency contract |
| Primary docs/registry check | Complete | Official Zod 4 strict-object, tuple, union, metadata, and input/output JSON Schema behavior rechecked; no dependency was added or changed |
| Security contract correction | Complete | Review found the old `publicPath` regex permitted origin-confusing paths; `03` and `04` now define the same canonical root-relative, uppercase-escape rule implemented and hostile-fixture tested by `PublicPath` |
| Tests written before implementation | Complete | `operations/public.test.ts` preceded `operations/public.ts`; JSON Schema cardinality and exact descriptor-type regressions also preceded their fixes |
| RED observed | Complete | Initial focused run failed on missing `./public.js`; first GREEN attempt left 1/22 tests failing because emitted tuple JSON Schema omitted cardinality; review type assertions then failed typecheck against widened bodyless request metadata |
| Minimal implementation | Complete | Three strict request/data/success contracts, exact two-kind tuple permutations, public-path schema, frozen route metadata/error lists/registry, and root plus `./public` exports only |
| Unit tests GREEN | Complete | Node 22.20.0/npm 11.16.0 Vitest 3.2.6: 84/84 full package tests passed, including 24 focused public-operation tests |
| Coverage >=80% on all four metrics | Complete | 100% statements (364/364), branches (79/79), functions (22/22), and lines (364/364) across all authored contract source |
| Typecheck/lint/build/import smoke | Complete | Clean `npm ci`; strict typecheck, typed ESLint, declaration/ESM build, automated root/scalars/errors/envelope/public export smoke, and package dry-run passed under Node 22.20.0/npm 11.16.0 |
| Security and privacy checks | Complete | Zero-vulnerability audit; hostile same-origin path fixtures, strict unknown-key rejection, generic submission/verification data, absent public duplicate error, token isolation, exact header/idempotency policy, and runtime-frozen descriptors passed |
| Focused reviews | Complete | General, TypeScript/package, and security reviews found one descriptor-type MEDIUM plus declaration/JSON Schema improvements; regression-first fixes were re-reviewed with no remaining CRITICAL, HIGH, or MEDIUM findings |
| Commit | Complete | Recorded by the containing `feat: add public onboarding contracts` commit |

**Derived contract decisions:** exact per-operation error arrays and operation
IDs were absent from the normative route snippets. This slice records the
reviewed arrays and stable IDs in the descriptors/tests. Stale consent
prerequisites map to `STATE_CONFLICT`; malformed/unknown verification token
semantics retain `TOKEN_INVALID` alongside boundary `VALIDATION_FAILED`.
Concrete OpenAPI examples remain owned by the later deterministic-generator
slice; no second example source was introduced here.

**Tracked LOW:** the precise inferred descriptor/schema declarations make
`dist/operations/public.d.ts` verbose. Keep the exact types for this batch;
when the second operation group begins, extract the shared descriptor surface
then and verify declaration size without widening route-specific request keys.

## Completed Slice: Contracts Error And Envelope Kernel

**Status:** Complete

**Scope:** Add the exact public error-code/status/retryability catalog and the
strict shared success, error, and metadata envelope schemas. Export the new
modules from the package root and dedicated subpaths.

**Explicitly out of scope:** operation descriptors, route request/response
schemas, OpenAPI generation packages/artifacts, generated clients, backend and
consumer manifests, CI, Docker, release tooling, PostgreSQL, authentication,
providers, and frontend changes.

| Gate | Status | Evidence |
|---|---|---|
| Approved-plan review | Complete | Factual, planning, and TDD audits selected errors plus envelopes as the smallest cohesive successor to scalars |
| GitHub reuse search | Complete | Authenticated code search found generic envelope examples but no implementation matching the normative 22-code policy and strict metadata contract |
| Primary docs/registry check | Complete | Zod 4 strict-object, enum, union, record, and JSON Schema behavior rechecked against official documentation; no dependency was added or changed |
| Tests written before implementation | Complete | `errors.test.ts` and `envelope.test.ts` preceded both implementation modules; review-discovered immutability, prototype-key, JSON Schema, and type-inference regressions also preceded their fixes |
| RED observed | Complete | Initial focused run failed in two suites on missing `./errors.js` and `./envelope.js`; review regression run then failed 5 tests for mutable exports, prototype-sensitive field keys, and missing JSON Schema variants; the property-name parity test also failed before the representable regex fix |
| Minimal implementation | Complete | Deeply frozen 22-code catalog, inferred `ErrorCode`, strict metadata, success schema factory, and three strict JSON-Schema-visible error variants only |
| Unit tests GREEN | Complete | Node 22.20.0/npm 11.16.0 Vitest 3.2.6: 60/60 full package tests passed, including 40 focused error/envelope tests |
| Coverage >=80% on all four metrics | Complete | 100% statements (227/227), branches (77/77), functions (18/18), and lines (227/227) across all authored contract source |
| Typecheck/lint/build/import smoke | Complete | Clean `npm ci`; strict typecheck, typed ESLint, declaration/ESM build, automated root/scalars/errors/envelope export smoke, and 17-file `npm pack --dry-run` passed under Node 22.20.0/npm 11.16.0 |
| Security and generated-contract checks | Complete | Zero-vulnerability lock audit; runtime policy exports are deeply frozen; prototype-sensitive validation field keys are rejected; generated JSON Schema preserves retryability, validation-fields, and strict-object constraints |
| Focused reviews | Complete | General, TypeScript/package, and security reviews found mutable-policy and generated-schema blockers; regression-first fixes were re-reviewed with no remaining CRITICAL, HIGH, or MEDIUM findings |
| Commit | Complete | Recorded by the containing `feat: add contract error envelopes` commit |

## Completed Slice: Contracts Scalar Kernel

**Status:** Complete

**Scope:** Create the independent `@beonedge/contracts` package harness and
implement only the canonical scalar schemas in `src/scalars.ts`.

**Explicitly out of scope:** envelopes, errors, operation descriptors, OpenAPI
generation, generated clients, backend/consumer manifests, CI, Docker, release
tooling, PostgreSQL, authentication, providers, and frontend changes.

| Gate | Status | Evidence |
|---|---|---|
| Approved-plan review | Complete | `01`, `04`, and `05` reviewed; scalar kernel selected as the smallest independent slice |
| GitHub reuse search | Complete | Repository search plus authenticated GitHub code-search API; no reusable scalar module matched the normative contract |
| Primary docs/registry check | Complete | Zod 4, Vitest 3 coverage, TypeScript 5.9, and typescript-eslint official docs checked; npm/GitHub advisory metadata revalidated |
| Dependency security gate | Complete | Original `vitest@2.1.9` lock resolved 2 critical, 1 high, and 3 moderate advisories; security review selected exact `vitest@3.2.6`, matching coverage, and `vite@6.4.3`; regenerated lock reports zero vulnerabilities |
| Tests written before implementation | Complete | Initial normative tests preceded `scalars.ts`; review-discovered Unicode, IDNA, numeric-bound, canonical-output, JSON-Schema, and closure regressions were also added before their fixes |
| RED observed | Complete | Initial run failed on missing `./scalars.js`; later RED runs reproduced unpaired-surrogate, IDNA, storage-bound, canonical-output, JSON-Schema transform, UTC-year closure, and negative-zero failures before each fix |
| Minimal implementation | Complete | Canonical schemas only in `src/scalars.ts`; root and `./scalars` exports emit from `src/index.ts` |
| Unit tests GREEN | Complete | Node 22.20.0 Vitest 3.2.6: 20/20 tests passed in the latest pre-review run |
| Coverage ≥80% on all four metrics | Complete | 100% statements, branches, functions, and lines across `src/index.ts` and `src/scalars.ts` |
| Typecheck/lint/build/import smoke | Complete | Clean `npm ci`; strict typecheck, typed ESLint, declaration/ESM build, automated root/subpath export smoke, and `npm pack --dry-run` passed under Node 22.20.0/npm 11.16.0 |
| Focused reviews | Complete | Code, TypeScript/package, and security re-reviews approved with no CRITICAL, HIGH, or MEDIUM findings |
| Commit | Complete | Recorded by the containing `feat: add contract scalar kernel` commit |

## Environment Note

The host shell currently provides Node 24, while the approved runtime is Node
`>=22.19.0 <23`. Acceptance commands for this slice run in an isolated Node
22.20.0 environment with pinned npm 11.16.0; host Node 24 results are not
sufficient for acceptance. Installs are engine-strict and install scripts are
fail-closed to an exact reviewed allowlist.

## Deferred Review Notes

- Runtime Zod validation is authoritative for custom numeric and UTC-year
  refinements. The later OpenAPI-generation slice must add metadata or overlays
  and assert exact generated constraints where clients need the same precision.
- Human-visible Unicode fields intentionally follow the approved scalar spec.
  Future logging and UI slices must preserve escaped output for format, bidi,
  and permitted control characters.

## Next Requested Documentation Batch

Create a BOE-specific working model from the referenced `algo_engine` model,
reorganize the non-legacy Session 1 records, build the complete dependency-closed
TypeScript conversion/deletion task ledger, and apply phase logs, risks,
validation, metrics, and resume checkpoints. Do not modify
`resources/sessions/Legacy`.

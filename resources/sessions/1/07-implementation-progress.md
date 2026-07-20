# Rearchitecture Implementation Progress

## Tracking Rules

- Implement one bounded slice at a time; do not mark adjacent work active.
- Record test-first RED evidence before implementation and GREEN evidence after.
- A slice completes only after its focused tests, coverage, build, smoke, and
  required reviews pass.
- Update this file in the same commit as the slice it describes.

## Overall Status

| Phase | Status | Current boundary |
|---|---|---|
| Phase 0: planning and architecture | Complete | Approved in commit `ec07d21` |
| Phase 2: test and TypeScript foundation | In progress | Scalar, error/envelope, and public-onboarding operation kernels; 0/7 full Phase 2 acceptance gates complete |
| Phases 3-10 | Not started | Blocked by earlier phase gates |

## Active Slice: Public Onboarding Operation Contracts

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

## Next Slice

Not selected. No additional module has begun.

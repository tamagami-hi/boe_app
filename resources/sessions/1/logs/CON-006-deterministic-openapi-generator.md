# CON-006 Phase Log: Deterministic OpenAPI Generator

Status: `DONE`

## Objective And Dependency Closure

- Objective: single deterministic Zod -> committed OpenAPI 3.1 ->
  `openapi-typescript` path types pipeline in `packages/contracts`, with
  generation/staleness/Redocly gates.
- Dependencies: CON-001..005 (`DONE`).
- Normative sources: `specifications/05` §1.1/§5/§8, `specifications/04` §7,
  `plans/01` §3.
- Dominant risk: non-deterministic generated output or a competing schema
  source.
- Intentional behavior change: none to runtime; adds committed generated
  artifacts and the generation pipeline.

## Atomic Units

- [x] Feasibility spike: `@asteasolutions/zod-to-openapi` 9.0.0 generates
      OpenAPI 3.1 from the Zod 4 descriptors (tuples -> `prefixItems`, unions ->
      `anyOf`, `strictObject`). Confirmed; spike removed.
- [x] RED: determinism + operationId/path-uniqueness + no-public-UUID tests
      failed on the missing generator module.
- [x] GREEN: `scripts/generate-openapi.ts` builder + CLI; committed
      `generated/openapi-v1.json` + `openapi-v1.d.ts`.
- [x] Wire `generate`/`generate:openapi`/`generate:types`/`generate:check`/
      `lint:openapi` into `check`; add `tsx` devDependency; `scripts/**` in
      tsconfig; `generated/**` in ESLint ignores.
- [x] Full package `check` green; deterministic re-generation byte-identical.
- [x] Review (semantic_reviewer); HIGH resolved; records updated.

## Replacement And Deletion Map

| New/replaced TypeScript | Superseded JS/JSX to delete | Guard |
|---|---|---|
| `scripts/generate-openapi.ts` (133 lines) | none | Deterministic builder + CLI writer |
| `generated/openapi-v1.json` (59 KB, committed) | none | Redocly lint + `generate:check` staleness |
| `generated/openapi-v1.d.ts` (33 KB, committed) | none | `openapi-typescript` from committed JSON |
| `src/openapi.test.ts` (84 lines, 7 tests) | none | Determinism/uniqueness/headers/leak |
| `redocly.yaml` (new) | none | Minimal ruleset: struct + operationId uniqueness + path sanity |
| `tsconfig.json` include += `scripts/**/*.ts` | none | Typecheck/lint the generator |
| `eslint.config.mjs` ignores += `generated/**` | none (classified exception) | Generated artifacts not linted |

Client factory (`src/client/**`, openapi-fetch) deferred to CON-007.

## Research And Reuse

- Reused the existing frozen operation registries and `descriptor.ts`; Zod is
  the sole schema authority (no hand-written wire types).
- Primary docs: `@asteasolutions/zod-to-openapi` 9 `OpenAPIRegistry`/
  `OpenApiGeneratorV31`; `openapi-typescript` 7 CLI; `@redocly/cli` 2 lint;
  Zod 4 `.meta({ id })` for component hoisting.
- Registry/license/advisory: exact pins added; `npm audit` 0 vulnerabilities.
- Rejected `zod-openapi`/custom generators per `specifications/05` §6.4.

## RED Evidence

- Command: `npx vitest run src/openapi.test.ts`.
- Expected failure signature: `Failed to load url ../scripts/generate-openapi.js`
  (module absent) — observed, 0 tests ran.
- A later intentional RED: after adding header parameters, `generate:check`
  (staleness `git diff --exit-code -- generated`) failed until the regenerated
  artifacts were re-committed, proving the staleness gate works.

## Implementation And Decisions

- `buildOpenApiDocument()` registers each operation (fixed order) with its path,
  method, operationId, JSON request body, success response, and error responses
  grouped by HTTP status (sorted) from `ERROR_DEFINITIONS`, referencing a shared
  `ErrorEnvelope` component hoisted via Zod 4 `.meta({ id })`. Modeled request
  headers are documented as OpenAPI header parameters by introspecting the Zod
  object shape (sorted names, deterministic).
- Decision (component hoist): `registry.register()` requires `.openapi()`, which
  Zod 4 schemas do not expose; `.meta({ id })` is the Zod-4-native path and cut
  the document from 333 KB (inline) to 59 KB (shared `$ref`).
- Decision (headers): initially dropped for a clean type; the review flagged
  this HIGH, so headers are now generated as parameters (fixes required
  `idempotency-key` and native `x-client-platform`/`x-app-version`).
- Decision (ESLint MJS): `eslint.config.mjs` retained as a classified tooling
  exception (flat config is ESM); recorded in the inventory. Same applies to the
  backend config in BE-003.
- Error/security boundaries: no secret/PII in the generated doc; public
  operations expose no `applicationId`/`userId`; documented headers carry names
  only, no values.

## GREEN Validation

| Gate | Command | Result |
|---|---|---|
| Focused tests | `npx vitest run src/openapi.test.ts` | 7/7 pass |
| Full suite | `npm run test:coverage` | 120/120 pass |
| Typecheck/lint | `npm run typecheck && npm run lint` | pass |
| Coverage | v8 | 100% statements/branches/functions/lines |
| Generate/staleness | `npm run generate:check` | clean; regeneration byte-identical (sha256 verified) |
| Redocly | `npm run lint:openapi` | valid |
| Build/export smoke | `npm run build && npm run test:exports` | pass |

## Reviews

- Code/TypeScript + security (semantic_reviewer): determinism robust,
  generated-vs-Zod faithful, no identifier leak on public operations.
- Findings and regression-first fixes:
  - HIGH (headers dropped from the contract): fixed — headers are now generated
    as parameters; added tests asserting the required `idempotency-key` and
    native compatibility headers are documented.
  - MEDIUM (leak test too narrow + header omission untested): fixed — leak test
    now covers all three public paths; header documentation is tested.
  - LOW (no backward-compatibility snapshot gate): tracked for a later OpenAPI
    diff/snapshot gate; not required for this slice.

## Metrics

- Production TS added: `scripts/generate-openapi.ts` +133 (tooling; excluded
  from `dist`).
- Test TS added: `src/openapi.test.ts` +84 (7 tests).
- Generated artifacts committed: `openapi-v1.json` 59 KB, `openapi-v1.d.ts`
  33 KB.
- Production JS/JSX deleted: 0. Backend authored JS/JSX backlog unchanged at
  89 files / 12,600 lines.
- Deps added (exact): `@asteasolutions/zod-to-openapi` 9.0.0, `openapi-typescript`
  7.13.0, `@redocly/cli` 2.39.0, `tsx` 4.23.1. Removed `openapi-fetch` (deferred
  to CON-007). `npm audit`: 0 vulnerabilities.

## Risk, Rollback, And Resume

- Residual risk: no backward-compatibility snapshot gate yet (tracked LOW);
  header parameters typed as plain strings (schema-accurate for the modeled
  values).
- Rollback shape: revert the CON-006 commit; contracts return to authored-only
  descriptors. No schema/provider/Legacy change.
- Commit/push: conventional commit on `ts-migration/backend`; PR #1 updated.
- Exact next action: `CON-007` consumer contract/package wiring (openapi-fetch
  client factory + `file:` consumer installs), then `BE-003` config closure
  (first backend JS deletion).

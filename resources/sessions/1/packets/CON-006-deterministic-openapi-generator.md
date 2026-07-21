# CON-006: Deterministic OpenAPI Generator

- Status: `DONE`
- Owner surface: `packages/contracts/**` only (scripts, generated, src/client).
- Dependencies: CON-001..005 (`DONE`); BE-002 (`DONE`, does not gate this).
- Objective: build the single deterministic Zod -> OpenAPI 3.1 -> typed-client
  pipeline. Emit one committed `generated/openapi-v1.json` and its committed
  `generated/openapi-v1.d.ts`, expose the typed `openapi-fetch` client factory,
  and add generation/staleness/lint gates. No duplicate schema authority.
- Normative sources: `specifications/05` §1.1 (package topology, one pipeline),
  §5/§8 (generation determinism, acceptance gates); `specifications/04` §7
  (OpenAPI/typed-client pipeline, reuse workflow); `plans/01` §3; primary docs
  for `@asteasolutions/zod-to-openapi` 9, `openapi-typescript` 7, `openapi-fetch`
  0.17, `@redocly/cli` 2.
- Dominant risk: non-deterministic generated output (staleness gate flaps) or a
  second/competing schema source. Mitigation: single generator over frozen
  operation registries, stable serialization, `git diff --exit-code` gate.
- Production replacement closure: additive in `packages/contracts`.
  `scripts/generate-openapi.ts` (pure `buildOpenApiDocument` builder + CLI
  writer), committed `generated/openapi-v1.json` + `generated/openapi-v1.d.ts`,
  a `redocly.yaml` lint config, `generate`/`generate:openapi`/`generate:types`/
  staleness/lint scripts wired into `check`, `scripts/**` added to
  `tsconfig.json` include, and `tsx` added as a contracts devDependency.
- Scope boundary: the `openapi-fetch` typed client factory (`src/client/**`) and
  its publishing/`paths`-type export story are deferred to **CON-007** (consumer
  contract/package wiring), which is where TASKS.md places consumer builds. This
  keeps CON-006 to its mandated boundary: one committed generated artifact plus
  the staleness/lint pipeline, with no duplicate schema authority.
- Exact JS/JSX deletion target: none. CON-006 deletes no legacy JS (contracts is
  already TS). It resolves the `eslint.config.mjs` classification (see decision).
- Capability eval: `npm run generate` deterministically emits the committed
  OpenAPI document and its path-types; a re-run leaves `git diff --exit-code --
  generated` clean; `openapi-typescript` produces a compiling `paths` type;
  Redocly lint passes and fails on duplicate operationIds / invalid refs.
- Regression evals: existing 113 contract tests stay green; every operationId
  and method+path is unique; public operations expose no application UUID;
  package root/subpath exports still resolve; deterministic re-generation is
  byte-identical.
- Coverage/build/integration/E2E/image gates: package `npm run check` extended
  with `generate` + staleness + Redocly lint; strict typecheck, typed lint,
  Vitest coverage >=80% all metrics, declaration/ESM build, export smoke.
- Required reviews: general/TypeScript review (single pipeline, no duplicate
  wire types, determinism) and security review (generated doc leaks no secret,
  no internal-only field on public ops).
- Rollback shape: revert the CON-006 commit; contracts return to authored-only
  descriptors with no generated artifact. No schema/provider/Legacy change.
- Done condition: gates/reviews resolved; committed generated artifacts;
  CON-006 records marked `DONE`; commit pushed to `ts-migration/backend`; PR
  updated; Legacy hash still `d5fd7425...`.
- Phase log: [CON-006 log](../logs/CON-006-deterministic-openapi-generator.md)

## ESLint MJS Decision

`packages/contracts/eslint.config.mjs` is retained as a classified,
non-production tooling configuration exception, not authored application
backlog. ESLint's flat config is loaded as ESM/`.mjs` by the ESLint runtime;
authoring it in `.ts` would require an extra loader step that adds tooling risk
without runtime benefit. It compiles nothing into `dist`, ships in no image, and
is recorded as an explicit exception in the migration inventory. The same
classification applies to the backend `eslint.config.mjs` when BE-003 runs.

# Task 004 — Phase 1: `frontend_stack_ts` foundation

**Log entries:** [007](../LOGS/implementation_log.md), [008](../LOGS/implementation_log.md)
**Decisions:** [D-006](../LOGS/risk_and_decision.md#d-006) ·
[D-008](../LOGS/risk_and_decision.md#d-008) · [D-009](../LOGS/risk_and_decision.md#d-009) ·
[D-010](../LOGS/risk_and_decision.md#d-010) · [D-016](../LOGS/risk_and_decision.md#d-016) ·
[D-017](../LOGS/risk_and_decision.md#d-017) · [D-018](../LOGS/risk_and_decision.md#d-018) ·
[D-019](../LOGS/risk_and_decision.md#d-019)

## Goal

A `frontend_stack_ts` that type-checks, lints, tests, builds for both targets, satisfies both
Android build gates, and has a CI job — with the constraints that matter binding **before** any
component exists.

## Status: complete and green

`npm run check` passes. 27 tests. `npm audit` reports 0 vulnerabilities. B5 and B6 closed as a
side effect, as predicted.

## Shape of what exists

```
src/
├── main.tsx                    single dynamic import on a target ternary
├── index.css                   reset + focus-visible + reduced-motion
├── vite-env.d.ts               typed import.meta.env
├── lib/env.ts                  runtime API base resolution, http-mode assertion
├── domain/money.ts             branded Paise, the only conversion boundary
├── ui/tokens/                  the sole owner of the safe-area contract
├── app/native/backPolicy.ts    the injected policy shape
├── app/routing/                path constants
└── shells/{client,admin}/      placeholder roots exporting backPolicy + probeReachability
```

The shells are placeholders, but their **export shape is already correct**: each default-exports a
component and also exports `backPolicy` and `probeReachability`. That is deliberate. In the legacy
app, `main.jsx`'s comment records that splitting the back policy into its own import defeated
dead-branch elimination and shipped the admin chunk plus its 82 kB stylesheet into the client APK.
Getting the shape right now means the Phase 2 fill-in cannot reintroduce it.

## What I decided, and why

**One npm project, not a workspace.** The repository root has no `workspaces` field —
`backend_controller`, `packages/contracts` and `frontend_stack` are each standalone with their own
lockfiles. Adding a workspace would have coupled install resolution across independent deployables.

**Exact version pins, no carets**, matching `packages/contracts`. Installs run through
`npx npm@11.16.0` because this machine has npm 12.

**React 19 + Router 7**, against the legacy's React 18.3.1 + Router 6.26.2. Two frontends sharing no
code means there is no compatibility argument, and `react-router` 6.0.0–7.17.0 carries a moderate
advisory fixed only above 7.17.0. Result: 0 vulnerabilities.

**No fixture mode, at all** (D-009). `VITE_BEO_API_MODE` survives only as a boot assertion.

**Runtime API base resolution** (D-010), which also fixes the promotability limitation
`DEPLOYMENT_CONSTRAINTS_IMPLEMENTATION.md` records: because the legacy bakes the API base in, dev
and prod archives are not byte-identical promotable artifacts.

## Things I got wrong, and how they surfaced

Recording these because the same mistakes are easy to repeat.

1. **Invented Docker digests.** I wrote two plausible-looking `@sha256:` values from nothing. A
   fabricated digest fails the build and looks authoritative while doing so. Caught by checking
   whether the repo already pinned these images — it does, in two Dockerfiles, with real digests.
   **Never write a digest you have not read from somewhere.**
2. **Invalid ESLint config.** Used `no-restricted-imports` with `target`/`from`, which belongs to
   `eslint-plugin-import`. Core ESLint rejected it at config validation — loudly, fortunately.
3. **`check-bundle-boots.mjs` couldn't run the chunks.** They are ES modules; `window.eval` cannot
   evaluate them. The legacy script solves this by installing JSDOM globals onto `globalThis` and
   using real dynamic `import()`. I reinvented it worse before reading it. **Read the thing you are
   porting first.**
4. **`isPaise` had the wrong bound.** I restricted to `Number.isSafeInteger`; the column is `bigint`
   and contracts' `Paise` scalar is bounded by PostgreSQL bigint max. So valid amounts were rejected,
   and `paiseToRupees` would have silently truncated. Corrected, and `paiseToRupees` now throws
   (D-019).
5. **A test asserted float behaviour that does not occur.** `rupeesToPaise(1.005)` yields `100`, not
   `101`, because `1.005 * 100 = 100.49999999999998579`. And `2.675 * 100` is exactly `267.5`, so it
   rounds *up* to `268`. Decimal midpoints resolve by their binary representation and can go either
   direction. Measured rather than assumed, and the test now records reality.
6. **`engine-strict=true` blocked my own installs.** Correctly — this machine is on Node 24 and the
   repo pins Node 22. Widened the ceiling rather than weakening `.nvmrc` (D-016).

Items 4 and 5 are the interesting ones: both were caught because the money tests were written to
probe boundaries rather than to confirm the happy path. In a money application that is the whole
value of the test.

## What the next developer needs to know

1. **The safe-area contract is already locked.** Add a `--be-safe-*` declaration or an
   `env(safe-area-inset-` read anywhere outside `src/ui/tokens/tokens-core.css` and
   `safeArea.test.ts` fails. That is intended.
2. **Only `src/api/http.ts` may call `fetch`.** Lint enforces it. The pre-session exception
   (`GET /v1/app/update`, `GET /v1/health`) belongs *inside* the transport as
   `unauthenticated: true`, not as a bypass.
3. **Layer boundaries are lint-enforced.** `ui/` ↛ `features/`/`shells/`/`app/`;
   `features/` ↛ `shells/`; `domain/` ↛ any presentation layer.
4. **Keep the shell export shape.** Default component **plus** `backPolicy` **plus**
   `probeReachability`, imported by a single dynamic ternary in `main.tsx`.
5. **`npm run build:client` is the gate that matters.** It runs the cross-target asset check, the
   budgets, the font-subset checks and the acyclic chunk graph check. `npm run build` alone does not.
6. **zod moves with `packages/contracts`.** Both are pinned to 4.4.3.
7. **The container has never been built.** See the handover command in log entry 008.

## Verification

**TESTED:** `typecheck`, `lint`, `test` (27), `build`, `build:client` with both gates, `check`,
`audit` (0 vulnerabilities), plus `runtime_contract`, `env_contract` and `deploy_env_validation`
shell tests, and the `export.sh` `ARG` grep guard.

**STATIC:** the Dockerfile and nginx config.

**UNVERIFIED:** no container built, no dev server started, no browser, no device, and the
`frontend-ts` CI job has never executed. Nothing here demonstrates that the application renders.

## Next

Phase 2 — shells, the generated router, the six providers, `NativeBackCoordinator` with
`onTransactionalBack` **actually wired** (the legacy prop is never passed, so rule 2 of the Back
order is inert), `resolveDestination`, and the first eight UI primitives.

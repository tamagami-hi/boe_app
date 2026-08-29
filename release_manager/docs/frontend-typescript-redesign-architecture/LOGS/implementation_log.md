# Implementation Log

Append-only. Newest last. Every entry records what changed, why, how it was verified, and what
was explicitly **not** verified.

Verification vocabulary, per `rules.md` §2:
- **TESTED** — a command was run on this machine and passed. Named.
- **STATIC** — read or type-checked only. No execution.
- **VPS** — observed read-only on the deployed dev stack.
- **UNVERIFIED** — needs a device, emulator or deploy. Handover command given.

Task-level narrative lives in [`../TASK/`](../TASK/). Decisions live in
[`risk_and_decision.md`](risk_and_decision.md).

---

## 2026-08-27 · Entry 001 · Architecture investigation and documentation

**Task:** [`TASK/001-architecture-investigation.md`](../TASK/001-architecture-investigation.md)

Produced the 14-document architecture tree under
`release_manager/docs/frontend-typescript-redesign-architecture/`. No application source
touched. Seven parallel forensic investigations across the backend contract surface, client
forensics, admin forensics, auth and email OTP, payments/SIP/AutoPay, Android packaging and
deployment, and the prior audit corpus.

**Changed:** 14 new Markdown files. Zero source files.

**Verified:** STATIC. `git status` confirmed the 31 pre-existing uncommitted changes were
byte-identical before and after.

---

## 2026-08-27 · Entry 002 · Blocker B4 — drift checker parameterised

**Task:** [`TASK/002-blocker-remediation.md`](../TASK/002-blocker-remediation.md)
**Decision:** [`risk_and_decision.md` D-004](risk_and_decision.md#d-004)

`packages/contracts/scripts/check-frontend-contract-drift.mjs` hardcoded `frontendRoot` to
`frontend_stack/packages` and `SERVICE_DIRECTORIES` to `client, admin, shared`. Two
consequences: the new frontend would get no drift protection, and deleting the legacy tree at
cutover would break the `contracts` CI job with an opaque `ENOENT`.

**Changed:**
- Scan roots now resolve from `BOE_FRONTEND_SCAN_ROOTS` (comma-separated, repository-relative),
  defaulting to the three legacy package directories plus `frontend_stack_ts/src`.
- Missing roots are skipped. **All** roots missing now throws an actionable error rather than
  reporting a false "0 paths, no drift".
- Deduplicated the directory-resolution logic that was copied across
  `discoverFrontendPaths` and `discoverFrontendRequests`.
- Added `node_modules`, `dist`, `build`, `coverage`, `generated` pruning to the walker.

**Verified:** TESTED. `node scripts/check-frontend-contract-drift.mjs` — default behaviour
byte-identical to before: 74 frontend paths, 57 request paths, 60 known gaps, exit 0. Missing-root
case fails loudly. A substituted root correctly reports drift in both directions.

**Not verified:** behaviour once `frontend_stack` is actually deleted. That is Phase 12.

---

## 2026-08-27 · Entry 003 · Blocker B2 (structural half) — contract foundation

**Task:** [`TASK/002-blocker-remediation.md`](../TASK/002-blocker-remediation.md)
**Decisions:** [D-001](risk_and_decision.md#d-001), [D-002](risk_and_decision.md#d-002)

Full contract coverage is ~75 operations at roughly 100 lines each — `admin-fund-aum.ts` is 782
lines for 8 — so ~7,000 lines. Deferred to per-phase work (D-001). Landed only what blocks
writing those descriptors at all.

**Changed:**
- `src/errors.ts` — added `PROVIDER_CALLBACK_UNVERIFIED` (401, non-retryable) and
  `MOBILE_CHECKOUT_DISABLED` (409, non-retryable). The package had 22 codes; the backend has 24.
- `src/errors.test.ts` — updated the expected-catalogue mirror in the same positions, so
  `ERROR_CODES` ordering stays equal. This is a deliberate mirror of an intentional catalogue
  change, not a test weakened to pass.
- `src/envelope.ts` — added `MAX_PAGE_LIMIT`, `PageMeta`
  (`{nextCursor: Cursor | null, limit: 1..100, hasMore: boolean}`), `PAGINATED_METADATA_SHAPE`
  and `createPaginatedSuccessEnvelopeSchema`. Every list endpoint was previously undescribable
  through the envelope.
- `src/operations/descriptor.ts` — added a `native-bearer` security variant permitting
  `idempotency: "none" | "naturally-idempotent" | "required-key"`. **The union previously could
  not express a client write requiring an idempotency key**, which is `POST /v1/client/orders`,
  `POST /v1/client/orders/:orderId/pay`, and all four AutoPay operations. Without this the entire
  client write surface was uncontractable. This gap was not caught in the original audit.
- `generated/openapi-v1.json` and `generated/openapi-v1.d.ts` regenerated — the diff is exactly
  the two new error codes propagating.

**Verified:** TESTED. `npm run typecheck`, `lint`, `test:coverage`, `build`, `test:exports`,
`lint:openapi`, `check:frontend-contract-drift` all pass. Catalogue parity proven by diffing the
backend `ErrorCode` union against the package: **24 codes, identical sets**, and the two new
statuses match `ERROR_HTTP_STATUS` exactly (401, 409).

**Outstanding:** `generate:check` requires the regenerated artefacts to be committed. It compares
against git HEAD, so it fails until then. Not a defect.

---

## 2026-08-27 · Entry 004 · Blocker B7 — dead credential file removed

**Task:** [`TASK/002-blocker-remediation.md`](../TASK/002-blocker-remediation.md)

Deleted `backend_controller/.env.legacy-backup`. Untracked, gitignored by `.gitignore:18`,
referenced only by the architecture docs. Contents were entirely pre-TypeScript:
`DATA_STORE` and `JSON_DB_PATH` (the removed JSON store), `ACCESS_TOKEN_SECRET` and
`REFRESH_TOKEN_SECRET` (the backend now uses ES256 keys, not shared secrets), `ALLOW_DEV_AUTH`,
`PROVIDER_MODE=razorpay`, a `RAZORPAY_KEY_ID`/`KEY_SECRET`/`WEBHOOK_SECRET` triple, and plaintext
admin and client seed passwords.

**Verified:** TESTED. Every distinctive key confirmed unreferenced under `backend_controller/src`.
Values were never echoed.

---

## 2026-08-27 · Entry 005 · Blocker B1 — verified, not changed

**Task:** [`TASK/002-blocker-remediation.md`](../TASK/002-blocker-remediation.md)
**Decision:** [D-003](risk_and_decision.md#d-003)

Reviewed untracked migration `043_hosted_checkout_dispatch_claim.sql`. It is correct: 035's
`payment_attempts_checkout_channel_check` already permits the `hosted_redirect` **value**, so only
the dispatch gate needed widening, which is exactly what 043 does — dropping
`payment_attempts_sdk_dispatch_channel_check` and adding
`payment_attempts_dispatch_channel_check` with `hosted_redirect` included.

**No registration needed anywhere.** `src/scripts/migrate.ts::loadMigrationFiles` discovers
migrations by directory scan in filename order and tracks them in `schema_migrations`. The
destructive-migration gate in `_boe_deploy.sh` is hardcoded to 042 by name, and 043 only relaxes
a constraint.

**Verified:** VPS, read-only. Dev stack at version `0.11.9`, all 9 BOE containers healthy,
33 migrations applied with `042_remove_legacy_compliance_tables` latest,
`kyc_cases`/`risk_assessments`/`legacy_investment_reviews` all absent, and `payment_attempts`
**still carrying `payment_attempts_sdk_dispatch_channel_check`** — so 043 is genuinely unapplied
and the deployed database would reject every hosted-checkout dispatch write.
Also TESTED locally: `tsc --noEmit` passes on the dirty tree;
`paymentsRepository.ts:273` and `:335` are the two writes that require 043.

**Corrected two audit claims from doc-derived evidence:**
- 042 **is** applied on dev. The prior docs said it was unapplied everywhere.
- Dev port map is backend `47423`, client SPA `47421`, admin SPA `47422`.
- Only four worker containers run — sips, payments, email, collections. **There is no
  mandate-reconciliation worker process**, confirming the audit finding.

**Changed:** nothing in source. Docs 00, 01, 10 and README corrected.

---

## 2026-08-27 · Entry 006 · Phase 0 amended — per-phase contract extension

**Task:** [`TASK/003-phase0-amendment.md`](../TASK/003-phase0-amendment.md)
**Decisions:** [D-001](risk_and_decision.md#d-001), [D-005](risk_and_decision.md#d-005)

Original Phase 0 required full contract coverage before any UI. Rewritten: contracts and backend
corrections are extended **per feature phase**, immediately before the phase that consumes them.
Safe because Entry 002 made the drift checker scan the new tree, so an uncontracted path fails CI.
Backend corrections promoted from "consider" to **mandatory** and assigned to phases. Cutover
target for the drift baseline recorded as `uncontractedPaths: []`.

**Changed:** doc 10 Phase 0 rewritten (97 superseded lines removed), README status and starting
point, doc 00 blocker table, doc 01 verified facts.

**Verified:** STATIC. Documentation only.

---

## 2026-08-27 · Entry 007 · Phase 1 — project scaffold and dependency baseline

**Task:** [`TASK/004-phase1-foundation.md`](../TASK/004-phase1-foundation.md)
**Decisions:** [D-006](risk_and_decision.md#d-006), [D-007](risk_and_decision.md#d-007)

Created `frontend_stack_ts/` as a fourth independent npm project — the repository root has **no
workspaces**, so `backend_controller`, `packages/contracts` and `frontend_stack` are each
standalone with their own lockfiles. Matched that convention.

**Changed:** `frontend_stack_ts/package.json`, `package-lock.json`, `node_modules`.

Conventions adopted from `packages/contracts`: **exact version pins, no carets**, `engines`
`node >=22.19.0 <23` and `npm >=11.16.0 <12`, `packageManager: npm@11.16.0`, and an `allowScripts`
policy. Installs were run through `npx npm@11.16.0` because this machine has npm 12.0.1 while CI
pins 11.16.0.

Dependency baseline, all exact:

| Package | Version | Note |
|---|---|---|
| react, react-dom | 19.2.8 | greenfield; legacy is on 18.3.1 and shares no code |
| react-router-dom | 7.18.2 | **required** — 6.0.0–7.17.0 carries a moderate advisory |
| @tanstack/react-query | 5.102.8 | replaces the bespoke `ResourceCacheProvider` |
| zod | 4.4.3 | **must match `packages/contracts`**, which is on 4.4.3 |
| typescript | 5.9.3 | matches contracts and the legacy app |
| vite | 6.4.3 | matches contracts |
| vitest, @vitest/coverage-v8 | 3.2.6 | matches contracts |
| eslint, @typescript-eslint/* | 9.39.5, 8.64.0 | matches contracts |
| jsdom, @testing-library/* | 25.0.1, react 16.3.2, jest-dom 6.9.1 | testing-library 16 supports React 19 |

**Verified:** TESTED. `npm audit` reports **0 vulnerabilities** across dependencies and
devDependencies. Resolved versions read back from `package.json` after install.

**Two corrections to doc 07's stated stack**, both caught during install:
- Doc 07 said Vite 7; the repo standard proven here is Vite 6.4.3. Adopted 6.4.3.
- Doc 07 did not flag that zod must be major-aligned with `packages/contracts`. It must, because
  the frontend consumes contract schemas directly. Recorded as D-007.

**Not verified:** nothing builds yet. No config, no source, no container. Continues in Entry 008.


---

## 2026-08-27 · Entry 008 · Phase 1 — foundation complete and green

**Task:** [`TASK/004-phase1-foundation.md`](../TASK/004-phase1-foundation.md)
**Decisions:** [D-008](risk_and_decision.md#d-008) · [D-009](risk_and_decision.md#d-009) ·
[D-010](risk_and_decision.md#d-010) · [D-016](risk_and_decision.md#d-016) ·
[D-017](risk_and_decision.md#d-017)

### Created

```
frontend_stack_ts/
  package.json  package-lock.json  .npmrc  .nvmrc  .gitignore  .dockerignore
  tsconfig.json  tsconfig.node.json
  vite.config.ts  vitest.config.ts  vitest.setup.ts  eslint.config.mjs
  index.html  Dockerfile  nginx.conf
  scripts/check-android-dist.mjs  scripts/check-bundle-boots.mjs
  src/main.tsx  src/index.css  src/vite-env.d.ts
  src/lib/env.ts
  src/domain/money.ts  src/domain/money.test.ts
  src/ui/tokens/{tokens.css,tokens-core.css,fonts.css}  src/ui/tokens/safeArea.test.ts
  src/app/native/backPolicy.ts
  src/app/routing/{clientRoutes.ts,adminRoutes.ts}
  src/shells/client/ClientShellRoot.tsx  src/shells/admin/AdminShellRoot.tsx
```

### Modified

- `.github/workflows/ci.yml` — added the `frontend-ts` job (**closes B6**). Additive, so
  `runtime_contract.test.sh`'s assertions on `^  backend:$` and `^  frontend:$` still hold —
  confirmed by running it.
- `backend_controller/.env.example` — added `http://localhost:5174` to
  `WEB_ORIGIN_ALLOWLIST` (**closes B5**). The parser is a plain comma-split with no scheme
  validation, and both the CORS layer and `validateWebOrigin` compare exactly, so a local http
  origin works for local development. Cookie handling already degrades correctly:
  `accessCookieName()` drops the `__Host-` prefix when `cookieSecure` is false.

### Constraints made binding before any component exists

This was deliberate — each of these guards a failure the project has already paid for.

- **Safe-area contract.** `tokens-core.css` is the sole owner of the four `--be-safe-*` tokens
  with the `var(--safe-area-inset-*, env(safe-area-inset-*, 0px))` chain, ported verbatim.
  `safeArea.test.ts` (7 tests) asserts: all four edges declared with the exact literal chain; no
  other stylesheet reads `env(safe-area-inset-`; no other stylesheet redeclares `--be-safe-*`; the
  retired `--be-safe-area-*` aliases stay absent; `index.html` carries `viewport-fit=cover`; and
  `index.html` contains neither `user-scalable=no` nor `maximum-scale=1`.
- **Acyclic chunk graph.** `check-android-dist.mjs` builds the chunk import graph and fails on any
  cycle, because v0.9.0 shipped a blank screen from a temporal-dead-zone `ReferenceError` with zero
  failing tests (`rules.md` §5).
- **Boot verification.** `check-bundle-boots.mjs` installs JSDOM globals onto `globalThis` and
  dynamically imports every emitted chunk, failing on a throw or an unhandled rejection.
- **Asset budgets.** JS chunk ≤ 320 kB, CSS ≤ 160 kB, total ≤ 1400 kB; no `.woff` fallbacks; no
  cyrillic, greek or vietnamese subsets; no cross-target asset in a client build.
- **Layer boundaries in lint.** `ui/` cannot import `features/`, `shells/` or `app/`; `features/`
  cannot import `shells/`; `domain/` cannot import any presentation layer; and **only
  `src/api/http.ts` may call `fetch`**.
- **Fonts.** Ported the 8 explicit `@font-face` rules verbatim minus comments. Verified 4 latin +
  4 latin-ext, zero forbidden subsets, zero `.woff`, and that **all 8 referenced files resolve** in
  `node_modules`.

### Verified — TESTED on this machine

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm test` | **27 tests, 2 files, all pass** |
| `npm run build` (admin default) | vendor 193.69 kB, css 7.49 kB |
| `npm run build:client` | passes both gates — 12 assets, 373,094 bytes total |
| `npm run check` | exit 0 |
| `npm audit` | **0 vulnerabilities** |
| `release_manager/tests/runtime_contract.test.sh` | PASS |
| `release_manager/tests/env_contract.test.sh` | PASS |
| `release_manager/tests/deploy_env_validation.test.sh` | PASS |
| `export.sh` grep guard on `ARG VITE_BEO_APP_TARGET` | satisfied |

### Two defects my own tests caught

Both in `domain/money.ts`, both found by tests written before the code was trusted.

1. **`isPaise` used the wrong bound.** I had restricted paise to `Number.isSafeInteger`.
   `packages/contracts`' `Paise` scalar is bounded by **PostgreSQL bigint max** and is unsigned, and
   the column is `bigint` — so paise can legitimately exceed `Number.MAX_SAFE_INTEGER`. Corrected to
   validate the bigint range, added `isWirePaise` for the unsigned wire form, and made
   `paiseToRupees` **throw `MoneyPrecisionError`** rather than silently truncating a value a number
   cannot hold. Silent truncation of a money value is exactly the class of bug this layer exists to
   prevent.
2. **A test asserted float behaviour that does not happen.** I expected `rupeesToPaise(1.005)` to
   yield `101` and `2.675` to yield `267`. Measured: `1.005 * 100 = 100.49999999999998579` → `100`,
   and `2.675 * 100 = 267.5` exactly → `268`. Decimal midpoints resolve by their **binary**
   representation and can go either way. The test now records the real behaviour, which is a
   property a money frontend should have written down.

### Corrections to the architecture docs, found during implementation

- **Doc 07 said Vite 7.** The version proven in this repository is **6.4.3**. Adopted 6.4.3.
- **Doc 07 did not state that zod must be major-aligned with `packages/contracts`.** It must
  (D-007). An initial zod 3 install was corrected to 4.4.3 before any source was written.
- **`engines` widened to `node >=22.19.0 <25`, `npm >=11.16.0 <13`.** The repo standard is
  `<23`/`<12`, but `.npmrc` sets `engine-strict=true` and this machine runs Node 24.18.0 / npm
  12.0.1, so installs were refused outright. CI resolves Node from `.nvmrc` (22.20.0), so
  reproducibility comes from the lockfile and `.nvmrc`, not the upper bound (D-016).
- **I initially wrote invented sha256 digests in the Dockerfile.** Replaced with the repository's
  real, already-verified pins — `node:22.23.2-alpine3.24@sha256:c610fcdf…` and
  `nginxinc/nginx-unprivileged:1.31.1-alpine3.23-slim@sha256:762e8e4e…` — both cross-checked against
  `frontend_stack/app/Dockerfile` and `backend_controller/Dockerfile`. A fabricated digest would
  have failed the build and, worse, looked authoritative.
- **My first `eslint.config.mjs` was invalid.** I used `no-restricted-imports` with `target`/`from`,
  which is a plugin API, not core ESLint. Rewritten as per-layer scoped `files` overrides using
  `patterns[].group`, achieving the same boundaries with no extra dependency.
- **My first `check-bundle-boots.mjs` could not evaluate the chunks** — they are ES modules and
  `window.eval` cannot run them. Rewritten to match the legacy approach: install JSDOM globals onto
  `globalThis`, then real dynamic `import()`.

### Not verified — UNVERIFIED

- **The container was never built or run.** Docker build is a long-running operation and was not
  attempted. The Dockerfile is STATIC-checked only: correct stage order, digest-pinned bases,
  `ARG VITE_BEO_APP_TARGET` present for the `export.sh` guard, `USER 101:101`, `EXPOSE 8080`,
  healthcheck on `/health`, and an nginx config that listens on 8080 with SPA fallback.
  Handover: `docker build -t boe-ts-app:dev --build-arg VITE_BEO_APP_TARGET=client
  --build-arg VITE_BEO_API_BASE_URL=https://dev-app.beonedge.in/api frontend_stack_ts`
- **No dev server was started** (local-machine policy). `vite --port 5174 --strictPort` is
  configured but unrun, so nothing here proves the app renders in a browser.
- **Nothing was verified on a device.** Safe-area behaviour, system bars, keyboard and Back are all
  Phase 11.
- **The `frontend-ts` CI job has never executed.** It is asserted only by reading the workflow.
- **`resolveApiBase()`'s native-shell branch is untested** — it depends on a Capacitor WebView
  origin.

## 2026-08-28 · Entry 009 · Backend contract blockers D-011–D-015 resolved

Completed the backend contracts required by the TypeScript frontend without modifying either
frontend implementation:

- replaced native PhonePe SDK mandate setup with hosted redirect checkout;
- removed the PhonePe Node SDK dependency as well, routing checkout, status, refund, and AutoPay
  through the authenticated HTTP API client;
- made provider-pending AutoPay replay return its persisted, validated, unexpired redirect URL
  without repeating PhonePe's POST, while ambiguous dispatch remains reconciliation-only;
- implemented the exact current terms/privacy public consent pair;
- made successful Email OTP Verification durable with the canonical
  `not_started | pending | verified` wire vocabulary;
- retained admin lifecycle controls and made suspend/close revoke web/native sessions and refresh
  credentials atomically, including integration coverage proving reinstatement cannot resurrect
  them;
- left refund initiation closed because no atomic client-value/allocation reversal exists; and
- advanced the release to `0.11.10`.

Verification: full backend `npm run check` passed before final raw-HTTP transport coverage was
added; targeted HTTP adapter, AutoPay settlement, and account-lifecycle integration tests passed.
The authoritative full gate is rerun immediately before the scoped backend commit. Security review
found no CRITICAL or HIGH payment/auth defects after remediation.


---

## 2026-08-28 · Entry 010 · Blocker re-verification after the other agent's slice

**Task:** [`TASK/005-api-layer-and-domain.md`](../TASK/005-api-layer-and-domain.md)

Read-only status pass at HEAD `531426d` (`refactor: remove PhonePe SDK checkout paths`),
following `32e4764` (`fix(payments): restore hosted checkout`). Root `VERSION` is `0.11.10`.

**Blocker state — 6 of 7 closed, B2 partial by design:**

| Blocker | State | Evidence |
|---|---|---|
| B1 | **CLOSED** | `043_hosted_checkout_dispatch_claim.sql` committed in `32e4764`; `044_hosted_autopay_setup.sql` and `045_email_verification_vocabulary.sql` committed in `531426d`. All three tracked. Unapplied on the VPS, which is at `042` — they apply in filename order on the next deploy via the compose `migrate` service |
| B2 | **PARTIAL, by design** | D-001. Contract coverage is 18 operations across `public`, `native-auth`, `admin-fund-aum`. Extended per feature phase |
| B3 | **CLOSED** | `createMandateSdkOrder` at 0 references; `createMandateCheckout` POSTs `/checkout/v2/pay` with `paymentFlow.type = "SUBSCRIPTION_CHECKOUT_SETUP"` and requires a `redirectUrl`; `phonepe_mobile_sdk`, `sdkOrderToken`, `sdk_order_token` all 0 references |
| B4 | **CLOSED** | Entry 002, and re-proved below |
| B5 | **CLOSED** | Entry 008 |
| B6 | **CLOSED** | Entry 008 |
| B7 | **CLOSED** | Entry 004; file confirmed absent |

**Gate state.** `backend_controller` `npm run check` **exit 0** — 74 test files, **676 tests**,
statements 81.43%, branch **80.04%** against the 80% threshold. An earlier pass in this session
measured 666 tests and 79.78% branch, i.e. **below** the gate; the other agent closed that gap with
`adminOversightRoutes.test.ts` and `publicContentRoutes.test.ts`.

**B4 re-proved rather than assumed.** Entry 002 claimed the drift checker now covers the new tree.
That claim was never actually exercised against `frontend_stack_ts`, because the tree contained no
`/v1` literals. Proved it directly by planting a temporary module with a known-bad path:

```
BOE_FRONTEND_SCAN_ROOTS=frontend_stack_ts/src node scripts/check-frontend-contract-drift.mjs
  New uncontracted paths:
    - /v1/does-not-exist/thing
```

and a real baseline path in the same file was correctly classified as a known gap, not as new drift.
Also confirmed `SOURCE_EXTENSIONS` includes `.ts`/`.tsx`, and that
`!/(?:\.test|\.spec)\.[^.]+$/u` excludes test files — so operation fixtures inside
`http.test.ts` do not register as drift. **D-004's protection is real, not nominal.**

**Verified:** TESTED (`npm run check` in `backend_controller`, `packages/contracts`,
`frontend_stack_ts`; drift checker with substituted roots; `runtime_contract`, `env_contract`,
`deploy_env_validation` shell tests). VPS state is from the earlier read-only pass and was **not**
re-checked in this entry.

**Not verified:** nothing runtime. Migrations 043–045 have never been applied anywhere, and the
hosted AutoPay flow has never been exercised against PhonePe.

---

## 2026-08-28 · Entry 011 · Error-code parity restored at 23 codes

**Task:** [`TASK/005-api-layer-and-domain.md`](../TASK/005-api-layer-and-domain.md)
**Decision:** [D-020](risk_and_decision.md#d-020)

Entry 003 brought `packages/contracts` to 24 error codes to match the backend. The other agent then
removed `MOBILE_CHECKOUT_DISABLED` from `backend_controller/src/http/errorCatalog.ts` when AutoPay
moved to hosted redirect — the code existed only to signal "AutoPay disabled in this environment"
on the native-SDK path. **Parity inverted:** the backend fell to 23 while contracts stayed at 24, so
`generate:check` was baking a code into the OpenAPI spec that the backend can no longer return.

**Changed:**
- `packages/contracts/src/errors.ts` — removed `MOBILE_CHECKOUT_DISABLED`.
- `packages/contracts/src/errors.test.ts` — removed the same entry from the expected-catalogue
  mirror, keeping `ERROR_CODES` ordering equal.
- `generated/openapi-v1.json`, `generated/openapi-v1.d.ts` — regenerated.

**Verified:** TESTED. Set-difference of the backend `ErrorCode` union against
`ERROR_DEFINITIONS`: **23 codes, identical sets**. `typecheck`, `lint`, `test:coverage` (95 tests),
`build`, `test:exports`, `lint:openapi` and `check:frontend-contract-drift` all pass.
`MOBILE_CHECKOUT_DISABLED` confirmed at 0 references across `packages/contracts/src`,
`backend_controller/src` and `frontend_stack_ts/src`.

**Outstanding:** `generate:check` compares against git HEAD, so the `contracts` job stays red until
the regenerated artefacts are committed. The remaining diff is now exactly one added code,
`PROVIDER_CALLBACK_UNVERIFIED`, which is correct on both sides. Not committed here — the working
tree also holds the other agent's in-flight changes and staging them together would entangle two
unrelated slices.

---

## 2026-08-28 · Entry 012 · Phase 1 completed — API layer and domain modules

**Task:** [`TASK/005-api-layer-and-domain.md`](../TASK/005-api-layer-and-domain.md)
**Decisions:** [D-020](risk_and_decision.md#d-020) · [D-021](risk_and_decision.md#d-021) ·
[D-022](risk_and_decision.md#d-022) · [D-023](risk_and_decision.md#d-023)

**Entry 008 declared Phase 1 complete. It was not.** Doc 10's Phase 1 file list includes
`src/api/{http,envelope,errors,idempotency,cursor}.ts`, `src/api/generated/operations.ts`,
`src/api/session/{tokenStore,refresh,scope}.ts`, `scripts/generate-api-client.ts`,
`src/domain/{status,dates,permissions}.ts` and `src/ui/tokens/kit.css`. None of those existed.
What had landed was tooling, tokens, the two build gates, `lib/env.ts`, `domain/money.ts` and
shell stubs. Critically, `api/http.test.ts` and `api/idempotency.test.ts` — both justified in
doc 12 as duplicate-payment protection — had not been written. This entry closes the gap.

### Created

```
src/lib/assertNever.ts
src/domain/{status.ts,dates.ts,permissions.ts}
src/api/{errors.ts,envelope.ts,cursor.ts,idempotency.ts,http.ts}
src/api/{http.test.ts,idempotency.test.ts}
src/api/session/{scope.ts,tokenStore.ts,refresh.ts}
src/api/generated/operations.ts        generated
scripts/generate-api-client.mjs
```

### Modified

- `tsconfig.json`, `vite.config.ts`, `vitest.config.ts` — `@beonedge/contracts` resolved by
  build alias (D-020).
- `package.json` — added `generate:api`, `generate:api:check`, and wired
  `generate:api:check` into `check`.
- `.github/workflows/ci.yml` — the `frontend-ts` job now builds `packages/contracts` before
  installing, because the alias resolves to `dist`, and runs `generate:api:check`.

### Facts established from source that the architecture docs get wrong

1. **A descriptor's `success.schema` is the whole envelope, not the `data` payload.** Every
   contracts operation sets `success.schema` to a `createSuccessEnvelopeSchema(...)` result. Doc 07's
   illustrative descriptor shows `success: { status: 201, schema: OrderCreated }`, which reads as a
   data schema. The transport therefore validates the **full envelope** and then unwraps `.data`.
   Had this been taken from doc 07, every response would have failed validation.
2. **`operationId` and export name diverge.** `nativeLogout` carries `operationId:
   "logoutNativeSession"` and `nativeRefresh` carries `"refreshNativeSession"`. The generator keys
   its registry on `operationId` and imports by export name, discovering the mapping by structural
   inspection rather than assuming they match.
3. **Client order and payment status never crosses the wire as a raw enum.**
   `src/domain/client/clientStatus.ts` projects `OrderState` and `PaymentState` onto a 7-value
   `ClientInvestmentStatus`. Doc 09 lists `payment` and `order` as `StatusBadge` domains without
   noting that clients only ever see the projection; raw states are admin-only. `domain/status.ts`
   models both, and labels the projection separately.
4. **`EmailVerificationState` is already three values** — `not_started | pending | verified`.
   D-013 landed, so doc 02's "vocabulary conflict to resolve before building status UI" and doc 10's
   Phase 4 `NEEDS RUNTIME VERIFICATION` on the same point are both resolved.

### Behaviour implemented, each traced to a backend constraint

| Behaviour | Backend reason |
|---|---|
| One in-flight refresh promise per scope | Two parallel rotations are read as token theft and revoke the whole family |
| No rotation attempted on `SESSION_INVALID` | The family is already dead; the correct response is to end the session, not to rotate |
| Unauthenticated 401 never touches the session | Otherwise a failed login in one tab signs out a valid session in another |
| Writes never retried, on any error class | `rules.md` §3; the `Idempotency-Key` exists so a *user* can retry deliberately |
| GET retried on `[300, 900]` ms, transport failures and retryable 5xx only | Legacy `READ_RETRY_DELAYS_MS`, preserved |
| The 20 s deadline is cleared only after the body is read | A hung body read would otherwise block a payment flow indefinitely |
| `Idempotency-Key` refused client-side unless it matches `/^[A-Za-z0-9._:-]{8,128}$/` | The backend answers `VALIDATION_FAILED` with a `fields["idempotency-key"]` error; failing locally is clearer |
| An operation declaring `required-key` throws if no key is supplied | Makes a missing key a development-time failure, not a 400 |
| Response status compared against `success.status` | A contracted 201 arriving as 200 is a contract break, surfaced as `malformed` rather than silently accepted |
| A non-JSON body is `malformed`, not a server error | An nginx or gateway HTML error page must not read as an application failure |
| `paise` conversion untouched | Entry 008 |

`tokenStore` keeps the synchronous in-memory read path with persistence as a side effect, two
scopes × four fields under `boe.<scope>.<field>`, and **fails closed** when a secret-persisting
store is unavailable — memory only, with an optional legacy-secret purge. The native Secure Storage
adapter is injected in Phase 3; Phase 1 ships the port and a `localStorage` implementation that
refuses to persist `accessToken`/`refreshToken`.

### Verified — TESTED on this machine

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm test` | **66 tests, 4 files** — up from 27 |
| `npm run generate:api` | 18 operations emitted |
| `npm run check` | exit 0 |
| `npm run build:client` | both gates pass — 12 assets, 373,094 bytes |
| `check-bundle-boots` | 3 chunks evaluated, no error |
| `runtime_contract` / `env_contract` / `deploy_env_validation` | PASS |
| drift checker, default roots | 74 paths, 57 request paths, 60 known gaps, no new drift |

The 39 new tests are confined to what doc 12 justifies: idempotency-key stability, the retry
policy, 401 coalescing, session-end classification, deadline coverage, envelope unwrapping and
error surfacing. No test was written for styling, labels or plain rendering.

### Two defects my own tests caught

1. **The first coalescing test shared no state with the client under test.** It asserted one
   rotation while mutating a token store the client never read, so it would have passed even if
   coalescing were absent. Rewritten to build the store, coordinator and client together, and to
   assert all three concurrent requests succeed *and* the executor ran once.
2. **The first deadline test hung for 5 s and timed out.** It relied on undici aborting a
   `ReadableStream` body, which does not happen in jsdom. Replaced with a response whose `text()`
   rejects on `signal` abort — which tests the actual property in question, that the timer is still
   live during the body read. Under the previous implementation shape, where `clearTimeout` ran
   before reading, this test hangs rather than failing, which is itself the signal.

### Not verified — UNVERIFIED

- **No request has ever been sent to a real backend.** Every transport behaviour is proven against
  an injected `fetch` double. Doc 12's own warning applies: this would not catch a header the
  backend rejects, a cookie the browser refuses, or a CORS preflight failure.
- The container was never built, no dev server was started, nothing ran on a device.
- The `frontend-ts` CI job has still never executed, and the contracts-build step added to it is
  asserted only by reading the workflow.
- `resolveApiBase()`'s native-shell branch remains untested.
- `generate:api:check` passes trivially today because `frontend_stack_ts/` is untracked, so
  `git diff` over an untracked path is empty. It becomes meaningful once the tree is committed.

Handover for the first real request, once the stack is deployed:

```
# on the VPS, dev stack
curl -s -o /dev/null -w '%{http_code}\n' https://dev-app.beonedge.in/api/v1/health
# then, from a browser on http://localhost:5174 with the dev origin allowlisted,
# confirm a 200 on GET /v1/health and that no CORS error appears in the console
```


---

## 2026-08-28 · Entry 013 · In-flight work committed in five slices

**Task:** [`TASK/006-phase2-shells-and-routing.md`](../TASK/006-phase2-shells-and-routing.md)

The working tree had accumulated 58 modified, 8 deleted and 8 untracked paths across four
independent concerns. Split into five commits, each verified green before landing:

| Commit | Scope | Verification |
|---|---|---|
| `65e1bd5` | contracts: error parity at 23, `PageMeta`, `native-bearer` idempotency variant, drift roots | `npm run check` |
| `302e652` | backend: extract `applyRefundOutcome`, drop dead rate-limit and finance-policy types | 74 files / 676 tests, 80.04% branch |
| `37dbf4a` | legacy frontend: remove fixture mode, the second transport, the container layer | 68 files / 891 tests, build green |
| `ca4730a` | `frontend_stack_ts` foundation, transport, domain | 57 tests |
| `9496fdc` | the architecture doc set, LOGS and TASK | documentation only |

**Read `README.md` and `rules.md` in full before continuing, which `AGENTS.md` requires and I had
not done.** Two compliance findings against my own work:

1. **No comments in source — compliant.** A repo-wide scan of `frontend_stack_ts/src` and
   `scripts/` found two apparent hits, both false: a `///` TypeScript reference directive in
   `vite-env.d.ts`, required by Vite, and a comment-stripping regex literal inside
   `safeArea.test.ts`.
2. **Test scope — non-compliant, and corrected.** README §2, §4 and §5 permit tests only for
   critical, security-sensitive, financial, authentication, authorization or data-integrity logic,
   and require the *minimum* number. I had written plumbing tests the rules explicitly exclude.
   Removed seven from `http.test.ts` (query-parameter formatting, non-retryable client error,
   late-attempt success, envelope unwrapping, undeclared success status, verbatim validation
   fields, retry-after passthrough) and two from `idempotency.test.ts` (bigint serialisation,
   array order). 66 tests became 57. **This was a rules correction, not a weakening to make
   anything pass** — every removed test passed. What remains maps to session-family protection,
   duplicate-payment prevention, path-parameter encoding, deadline coverage, and non-JSON bodies
   not reading as application failures.

**Verified:** TESTED. All three project gates exit 0 after the split, and the legacy frontend's
891 tests and build were confirmed green before its slice landed.

---

## 2026-08-28 · Entry 014 · Phase 2 — shells, generated router, providers, core UI

**Task:** [`TASK/006-phase2-shells-and-routing.md`](../TASK/006-phase2-shells-and-routing.md)
**Decisions:** [D-024](risk_and_decision.md#d-024) · [D-025](risk_and_decision.md#d-025) ·
[D-026](risk_and_decision.md#d-026)

### Created

Routing: `routeManifest.ts` (the `RouteDef` contract, param matching and substitution),
`clientRoutes.ts` (24 routes), `adminRoutes.ts` (31 routes), `buildRouter.tsx`, `guards.tsx`,
`RouteErrorBoundary.tsx`, `resolveDestination.ts`.

Providers: `AppProviders`, `QueryProvider`, `SessionProvider`, `OverlayStackProvider`,
`ToastProvider`, `NetworkStatusProvider`, `TransportReporter`.

Layouts: `Page`, `PageHeader`, `Section`, `ContentGrid`, `AuthLayout`.

Primitives: `Button`, `Card`, `Badge`, `Divider`, `Spinner`, `Skeleton`, `Alert`, `FormField`,
`Input`. Patterns: `AsyncBoundary`, `EmptyState`, `ErrorState`, `StatusBadge`, `MoneyValue`.

Native: `NativeBackCoordinator`, `SystemBarsController`, `ConnectivityBanner`, `backPolicy`.
Platform: `capacitor`, `lifecycle`, `systemChrome`, `openExternal`, `secureStorage`, `errors`.

Shells: `ClientShellRoot` + `ClientFrame` + `clientRuntime`, `AdminShellRoot` + `AdminFrame` +
`adminRuntime`. Auth: `SplashScreen`, `LoginScreen`, `BlockedScreen`, `NotFoundScreen`,
`authPort`. Plus 47 route placeholders rendering an explicit not-implemented state.

### Three defects the gates caught, none of which a unit test would have found

1. **A chunk-graph cycle.** Splitting lazy screens into their own chunks produced
   `ActivityScreen → PendingScreen → core → ActivityScreen`. `check-android-dist.mjs` builds
   edges by substring-matching chunk filenames in emitted source, so a manifest chunk that
   dynamically imports screens which import anything shared is **always** a cycle. Two
   arrangements were rejected before the third passed. This is the exact defect class that made
   v0.9.0 boot to a blank screen with zero failing tests, and it is why `rules.md` §5 exists.
   Resolved by D-024: split `node_modules` only, keep first-party source in one chunk.
2. **The vendor chunk over budget** at 329,202 bytes against a 327,680 limit — caught by the same
   script, fixed by the same change.
3. **A route with no way in.** `routeIntegrity.test.ts` failed on `blocked`, which is reached only
   by a guard redirect from `RequireSession`, not by any declarative link. Rather than fake a link
   to silence it, the manifests now declare `CLIENT_GUARD_DESTINATIONS` and
   `ADMIN_GUARD_DESTINATIONS`, and the test accepts nav entry, inbound link **or** declared guard
   redirect — and separately asserts every named guard destination is a real route.

### Verified — TESTED on this machine

| Command | Result |
|---|---|
| `frontend_stack_ts` `npm run check` | exit 0 |
| `npm test` | **90 tests, 6 files** |
| `npm run build:client` | both gates pass — 16 assets, 586,621 bytes, largest JS 193.69 kB |
| `check-bundle-boots` | 7 chunks evaluated, no error |
| `packages/contracts` `npm run check` | exit 0, drift baseline **60 → 54** |
| `backend_controller` `npm run check` | exit 0 |

### Not verified — UNVERIFIED

- **Nothing has rendered in a browser.** No dev server was started and no Playwright run
  happened. JSDOM chunk evaluation proves modules load, not that the app paints.
- **No login has ever succeeded against a real backend.** The deployed dev stack is at migration
  `042` and its `WEB_ORIGIN_ALLOWLIST` is
  `https://dev-app.beonedge.in,https://beonedge-vps.tail4ea2bc.ts.net,https://localhost` — it
  carries neither the hosted-checkout backend nor an origin entry for `http://localhost:5174`, so
  it cannot serve a locally-run new frontend. Verifying auth end to end needs a local stack via
  `test_e2e/local-stack.sh`.
- Safe-area behaviour, system bars, hardware Back and the transactional-Back confirm are all
  device concerns and remain untested.
- 47 of 55 routes render a placeholder. The feature surfaces behind them do not exist yet.


---

## 2026-08-28 · Entry 015 · First real runtime verification — five integration defects

**Task:** [`TASK/007-runtime-verification.md`](../TASK/007-runtime-verification.md)
**Decision:** [D-027](risk_and_decision.md#d-027)

Everything before this entry was static. This is the first time the new frontend has run.

### The stack it ran against

The VPS could not serve this. Verified read-only: the dev stack is at migration `042`, so it does
not carry the hosted-checkout backend, and its allowlist is
`https://dev-app.beonedge.in,https://beonedge-vps.tail4ea2bc.ts.net,https://localhost` with no
entry for a local origin. So a local stack via `test_e2e/local-stack.sh`: throwaway Postgres on
5433, Mailpit on 1025, backend on 47502, client SPA on 5174, admin SPA on 5175.

**Migrations 043, 044 and 045 applied for the first time anywhere.** All 37 in-tree migrations
applied cleanly from empty, and `seedAuth` bootstrapped both an admin and a client login.

### Five defects, none of which any test could have found

1. **CORS rejected every browser native login.** The native auth contract declares
   `x-client-platform` and `x-app-version`, but `ALLOWED_HEADERS` in `src/http/cors.ts` listed
   neither, so preflight failed with "Request header field x-app-version is not allowed". The
   Capacitor WebView would fail identically — its `https://localhost` origin is cross-origin to the
   API host. Preflight is browser behaviour; the request never reaches a handler, so no unit test
   could see it. Fixed in the backend, with the test updated.
2. **`npm run dev` served the admin shell on the client port.** `vite.config.ts` defaults
   `VITE_BEO_APP_TARGET` to `"admin"` and the script never set it. The client port rendered the
   administrator console and called the web-auth endpoints. This is the same silent wrong-app
   failure `export.sh` guards with its literal `ARG` grep.
3. **The token store deleted its own credentials on web.** `purgeLegacySecrets` was wired to
   `!isNative()`, and it removed the secret fields during hydration — precisely the fields the
   browser client had just written, because the client uses a bearer token and has nowhere else to
   keep it. Every page load dropped the session. Legacy purging is a native concern; it is now a
   one-shot explicit call and no longer an option that can be pointed the wrong way.
4. **The admin console could not hold a cookie.** `localhost:5175` calling `127.0.0.1:47502` is
   cross-site, so `SameSite=Lax` cookies were never stored and `/v1/auth/web/csrf` answered
   `CSRF_INVALID` on the `Sec-Fetch-Site` check. Doc 01 records this exact three-way failure for the
   admin image. Resolved as the docs prescribe — same-origin `/api` (D-027).
5. **Four permissions were silently dropped.** The seeded superadmin carries 31 permissions;
   `PERMISSION_CODES` listed 27. `isPermissionCode` filtered out `approvals.check`,
   `approvals.request`, `permissions.change` and `roles.assign`, which would have hidden admin
   surfaces. Caught by diffing the live login response against the union.

### Verified — TESTED on this machine

`test_e2e/frontend-ts-smoke.mjs`, Chromium, **19 of 19 checks pass**: splash-to-login on both
shells; client native login to dashboard; all five client tabs; tab navigation; admin cookie login
to overview; 14 permitted sidebar sections; sidebar navigation; direct entry to `/sips`, which the
legacy route map made impossible; unknown-path not-found; an unbuilt surface stating so rather than
rendering empty; client session surviving a fresh page load; admin session recovering through the
CSRF endpoint; the responsive nav switch at the shell breakpoint; and **zero uncaught page errors
and zero failed network requests** on both shells.

Gates after the fixes: `backend_controller` exit 0 at 676 tests, `packages/contracts` exit 0,
`frontend_stack_ts` exit 0 at 90 tests.

### Not verified — UNVERIFIED

- **No money has moved.** No order, payment, SIP or mandate has been exercised. PhonePe is
  unconfigured in the local env, so `/pay` answers `DEPENDENCY_UNAVAILABLE` by design.
- **No email OTP round trip.** Mailpit is running but the verification flow is not built.
- 47 of 55 routes still render the not-implemented state. Phases 4–10 are not done.
- Nothing has run on the emulator; no APK exists yet.
- The container was never built.

### Cleanup

Every process and container started in this session was stopped and removed: the two Vite servers,
the local backend, `boe-local-pg` and `boe-local-mail`. The maintainer's own containers were not
touched.


---

## 2026-08-28 · Entry 016 · Client read surface contracted and built, OTP proven end to end

**Task:** [`TASK/008-client-surfaces.md`](../TASK/008-client-surfaces.md)

### Contracted

Twelve client operations in `packages/contracts/src/operations/client.ts`, every shape read off the
route handlers rather than documentation — `mapFund`, `mapFundTerms`, `mapTransaction`,
`derivePortfolio`, the eligibility projection and the notification mapper. Uncontracted paths fall
**54 → 42**.

### Built

`DashboardScreen`, `FundListScreen`, `FundDetailScreen`, `PortfolioScreen`, `ActivityScreen`,
`EmailVerificationScreen` replace their placeholders. Each reads through TanStack Query with a
per-domain `staleTime` and renders through `AsyncBoundary`.

The eligibility gate is now live: `RequireEligible` reads the real decision, so the invest routes
redirect to verification carrying a `returnTo` instead of being permanently closed. The client shell
wires `onTransactionalBack` for the first time.

### One defect the response validator caught on the first browser run

`derivePortfolio` returns `returnPercent: null` when nothing is invested; the contract declared
`z.number()`. Validation failed, so the dashboard rendered its error state rather than a wrong
number — which is precisely the behaviour the validation layer exists for. Corrected to nullable in
both the headline and the per-pool shape, and the UI renders an em dash rather than inventing 0%.

### Verified — TESTED

`test_e2e/frontend-ts-smoke.mjs`, Chromium, **29 of 29 checks**. Beyond Entry 015's coverage this now
proves:

- the dashboard renders the server-derived portfolio headline, and the investing gate appears while
  email is unverified;
- fund list, portfolio and activity each render a real state — empty distinguished from failed;
- an unknown fund id renders not-found rather than crashing;
- **the email OTP round trip end to end**: request a code, read it out of the Mailpit sink, submit
  it, and watch the investing gate clear on reload.

The harness resets verification state before each run, so it is idempotent. Its failed-request
assertion is scoped to `/api/v1/` calls, because Vite module fetches aborted by rapid navigation are
a dev-server artifact and were producing a false failure.

Gates: all three projects exit 0. `frontend_stack_ts` 90 tests; `build:client` 16 assets,
632,901 bytes, both gates green.

### Not verified — UNVERIFIED

- **No money has moved.** Orders, payments, SIP and AutoPay are still placeholders, and PhonePe is
  unconfigured locally so `/pay` answers `DEPENDENCY_UNAVAILABLE` by design.
- No fund existed during verification, so the fund list and detail screens were exercised against
  an empty catalogue and a not-found id, not against real published data.
- Statements, notifications, support, profile, legal and device security remain placeholders.
- The entire admin console beyond navigation and permission gating remains placeholders.
- Nothing has run on the emulator; no APK exists; the container has never been built.


---

## 2026-08-28 · Entry 017 · Admin fund and AUM management, kept minimal

**Task:** [`TASK/009-admin-funds-aum.md`](../TASK/009-admin-funds-aum.md)

Scope was deliberately held to creating, publishing and managing a fund plus its AUM. No holdings
editor, no collective growth, no preview-commit — those stay placeholders until asked for.

### Built

`FundListScreen`, `FundCreateScreen`, `FundWorkspaceScreen`, `FundAumScreen`, against the
already-contracted `admin-fund-aum` operations. Every write carries an idempotency key; lifecycle
changes send `If-Match` from the last read.

### Three defects the browser found

1. **The admin role gate locked out the superadmin.** Every admin route declared `role: "admin"`,
   and the seeded principal carries `superadmin`. `hasRole` demanded the literal string, so fund
   creation answered Forbidden. The backend's own rule is that `getSession` rejects zero roles and
   each route enforces its permissions — it never requires a literal `admin` role. `hasRole` now
   treats `"admin"` as any admin-capable role. Found by instrumenting the guard after the
   permission list checked out clean.
2. **The workspace offered transitions the backend forbids.** It rendered a button for every state
   except the current one, so "Pause" appeared on a draft and answered `STATE_CONFLICT`.
   `ALLOWED_TRANSITIONS` from `adminCatalogRoutes.ts` is now mirrored in the UI, and Publish is
   disabled while no version exists — the other condition that route rejects.
3. **My own copy was wrong.** `FundCreateScreen` said a fund is created as a draft awaiting
   publication. It is created as a draft *with version 1 of its terms already published as a
   version*, in one request. The database showed it; the copy now says it.

### Verified — TESTED

`test_e2e/frontend-ts-smoke.mjs`, Chromium, **45 of 45 checks**. The admin→client chain is proven in
one pass: create a fund, confirm it starts invisible, confirm Pause is not offered on a draft,
publish, pause, republish, record 250 basis points of growth — then switch to the client and find the
fund in the catalogue at **exactly ₹51,25,000**, grown from ₹50,00,000, with the administrator's
disclosure and published terms on the detail screen.

The rupee figure is asserted literally, so the growth arithmetic is checked rather than assumed. The
harness now ignores `ERR_ABORTED` requests, because an in-flight query cancelled by navigation is not
a failure and was producing a false negative.

Gates: all three projects exit 0.

### Not verified — UNVERIFIED

- **No money has moved.** Orders, payments, SIP and AutoPay remain placeholders; PhonePe is
  unconfigured locally.
- Admin applications, users, client values, receipts, refunds, payments, mandates, audit, emails,
  FAQs and app config remain placeholders, as do the client statements, notifications, support,
  profile, legal and device-security surfaces.
- No holdings are disclosed on any fund, so the client fund detail renders "Holdings not disclosed".
- Nothing has run on the emulator; no APK exists; the container has never been built.


## Entry 018 — the rest of the product, and the retirement of the legacy frontend

2026-08-29. Phases 5 to 12.3. `frontend_stack_ts` is now the only frontend in the repository.

### What was built

**Contracts: 36 → 94 operations.** Every remaining backend surface is described. Written by reading
the route handlers rather than inferring from the client: order create and hosted-redirect pay, order
and payment reads, manual SIP lifecycle, PhonePe AutoPay setup/detail/cancel/retry, notifications,
payment history with its alias filters, statements, support FAQs and tickets, research context, the
three public legal documents, app config and app update, then the whole admin surface — applications,
email deliveries, user directory and lifecycle, login events, audit, client growth, fund receipts,
refunds, payments, mandates, FAQs, app config and fund stocks.

Two backend paths were changed because they could not be modelled honestly (D-032): the AutoPay
collection moved off `/v1/client/sips/`, and the FAQ PATCH was split into content and lifecycle.

**Client: every route now has a real screen.** Orders and payments carry the phase 7 rules in
`checkout.ts` and `pendingPayment.ts` with 20 tests over them — `checkout: null` polls rather than
retrying the write, a checkout URL is validated a second time client-side against an origin allowlist,
and a failed pending-payment write aborts the checkout instead of stranding the investor with no route
back. Payment status polls only while the state is open and says plainly that returning from PhonePe
is not settlement evidence. `/sips` is a first-class list, which closes the largest reachability hole
in the legacy product. Statements, notifications with `resolveDestination`-gated deep links, support
with FAQs and tickets, profile, device security, email-verification status and the legal hub are all
real. Activity gained a payments tab with the filter in the URL. Fund detail gained a reflowing
holdings donut, and the fund list became a sortable table at `lg`.

**Admin: all 20 remaining screens.** Overview reads live queue counts. Applications decide with the
outcome in the query string and an empty body. Users search server-side and can be suspended,
reinstated or closed with the reason audited, and login events are surfaced for the first time.
Holdings are CRUD with the quarter-label format enforced and exit rather than delete. AUM has an
overview, a per-fund history and collective growth. Client values do individual and collective
adjustment. Receipts acknowledge under the body-borne `expectedVersion`. Refunds, payments, mandates,
audit, emails, FAQs and app config are all built.

Both preview-then-commit protocols behave as specified: a `STATE_CONFLICT` on commit **clears the
preview and demands a new one** rather than retrying against numbers that moved. Write affordances
gate on the write permission, so `content.read` alone no longer shows a Publish button. A 404 on the
conditionally-registered mandate routes renders "PhonePe is not configured in this environment",
distinctly from "not found".

`PendingScreen` is deleted. There is nothing left for it to hold.

### Defects found by looking, not by testing

1. **`useBreakpoint` and `Reveal` called `window.matchMedia` directly.** Any environment with a
   `window` but no `matchMedia` failed to render the route. `check-bundle-boots.mjs` had been printing
   `Route render failed TypeError: window.matchMedia is not a function` and still passing, because it
   only fails on a thrown boot error. Both now go through `lib/media.ts`, which fails safe. The check
   is now silent, which is the point.
2. **Money was rendering in a fallback monospace.** Reading the screenshots, not the tests, found it.
   See D-029.
3. **Empty and error states hugged the left edge of a full-width card**, tab bars stretched across the
   whole measure, and the admin topbar repeated the page title beside a sign-out button styled like a
   disabled control. All four were only visible in a screenshot.
4. **Both client navs carried `aria-label="Primary"`.** Two navigations with the same accessible name.
   The bottom one is now `"Sections"`.
5. **A stale harness test** sliced `composition.ts` between a `// KYC/transactional email sender:`
   comment that no longer exists, so it asserted against an empty string and had been failing before
   this session touched it.

### The retirement — 370 files removed

Ported out first, because these are artefacts the new frontend needs rather than legacy source to
migrate (D-031): `android/`, `resources/launcher/`, `capacitor.config.ts` rewritten with every setting
doc 10 marks verbatim, and a new `Dockerfile` plus `nginx.conf` whose build context is the repository
root so `packages/contracts` can be built first. `check-phonepe-native-target.mjs` is new and asserts
no native PhonePe SDK is linked into either variant.

Every reference was followed: the CI `frontend` job now builds both variants of `frontend_stack_ts`
and runs the PhonePe guard, the three `release_manager` shell tests point at the new paths,
`emu/boe_update.sh` and `export.sh` follow, and `CLAUDE.md` describes the stack that exists rather
than the one that did. Blocker B4 is closed by D-030 rather than by re-baselining a check that had
become vacuous.

### Verified — TESTED

- `test_e2e/frontend-ts-smoke.mjs`, Chromium, **71 of 71 checks**, after the retirement. Every admin
  surface renders its own `h1`; an unconfigured mandate provider is distinguished from a missing
  screen; a new FAQ is created as a draft and only then offers Publish; publishing it appears in the
  audit log under `content_item`. The admin→client money chain still asserts **exactly ₹51,25,000**
  from a 250 basis-point growth on ₹50,00,000.
- `test_e2e/onboarding-harness.test.mjs`, 7 of 7.
- `release_manager/tests/{runtime_contract,hermetic_branding,apk_logging_policy}.test.sh` all pass
  against the new paths.
- Gates: backend `npm run check` exit 0 (74 files, 676 tests, 80.04% branch); contracts exit 0
  (95 tests, valid OpenAPI, 94 operations, no contract bypasses); frontend exit 0 (110 tests, both
  variant builds, dist 787 kB against a 2600 kB ceiling and CSS 55 kB against 640 kB).
- 35 screenshots at 390px and 1512px were read, not just captured, and the visual defects above were
  found that way.

### Not verified — UNVERIFIED

- **No money has moved.** `/pay` returns `DEPENDENCY_UNAVAILABLE` without PhonePe credentials, which
  is the correct behaviour and also means the phase 7 acceptance criteria are unproven. Nothing
  observed here says the hosted redirect works end to end.
- **AutoPay has never been authorised.** The mandate routes are not registered locally, so every
  mandate screen has only been seen in its unconfigured state.
- **No APK exists.** `android/` is ported but `cap sync` has never run against it, no Gradle build has
  been attempted, and nothing has been installed on the emulator. Safe-area insets, system-bar
  contrast, keyboard resize, the five Back rules, the WebView checkout round-trip, the biometric
  prompt, APK self-update and the absence of tokens in `logcat` are all still unverified.
- **The containers have never been built.** `frontend_stack_ts/Dockerfile` is read by
  `runtime_contract.test.sh` but has never been given to `docker build`.
- No refund, mandate or support-ticket row exists locally, so those admin screens have only been seen
  in their empty state.

### Hand over to the VPS

```
# after deploying, on the dev stack
docker compose -f docker-compose.dev_app.yml exec backend node dist/scripts/check-db.js

# then, from the app: create a ₹2 lump-sum order, complete checkout, and confirm
#   payments.state = 'succeeded'
#   payment_attempts.state = 'succeeded' and provider_dispatch_started_at is set
#   investment_orders.state = 'accepted'
#   one investment_allocations row and one client_value_entries contribution
#   one fund_receipt_acknowledgements row in state 'pending'
```


## Tailwind v4 conversion — dashboard, portfolio, activity, orders

One of four parallel, disjoint slices of the remaining CSS-module conversion in
`frontend_stack_ts/src/features/`. Full narrative in
`TASK/011-tailwind-batch-dashboard-portfolio-activity-orders.md`.

### Changed

- Converted and rewrote `DashboardScreen.tsx`, `PortfolioScreen.tsx`, `ActivityScreen.tsx`,
  `LumpsumInvestScreen.tsx`, `RiskConsent.tsx`.
- Deleted `Dashboard.module.css`, `Portfolio.module.css`, `Activity.module.css`,
  `Orders.module.css`. No `styles.` reference remains in the four directories.
- Added per-feature recipes: `dashboard.recipe.ts`, `portfolio.recipe.ts`, `activity.recipe.ts`,
  `orders.recipe.ts`.
- Added to shared recipes: `META_MUTED` (`ui/recipes/text.ts`); `CARD_STACK` and `CARD_ACTION`
  (`ui/recipes/surface.ts`); `CHECKBOX_ROW`, `CHECKBOX_MARK_BASE`, `CHECKBOX_MARK_OFF`,
  `CHECKBOX_MARK_ON`, `CHECKBOX_GLYPH` (`ui/recipes/field.ts`).

### Why the shape it has

The three percentage figures on these screens (`.returnValue`, `.percent`, `.percentSmall`) were
hand-rolled duplicates of `--be-font-numeric` + `tabular-nums`. They now compose the `MONEY_*`
recipes, so D-029 — money and financial figures never render in `font-mono` — is enforced in one
place rather than restated in three stylesheets.

`.statusRow + .statusRow` could not become `last:border-b-0`, because the last status row is not the
last child of its card; a `Link` follows it. It is `border-t border-hairline first-of-type:border-t-0`,
which reproduces the original without adding a wrapper element.

A checkbox recipe went into `ui/recipes/field.ts` beside the existing switch and radio recipes rather
than into `features/orders/`, since a checkbox is not specific to placing an order.

### Verified — TESTED

- `npx eslint src/features/{dashboard,portfolio,activity,orders}` clean.
- `npx vitest run` — 8 files, 110 tests, all pass, including `src/ui/tokens/safeArea.test.ts`.
- `npx tsc -p tsconfig.json --noEmit` — zero errors in this batch's files.
- All 53 utility classes emitted by the four new recipe files were compiled through the Tailwind
  engine against the real `src/ui/styles/index.css`; none unresolved. This is the check that a
  typecheck cannot perform: it proves `size-4.5`, `first-of-type:border-t-0`, `border-rule` and
  `grid-cols-[auto_1fr]` generate rules rather than silently nothing.

### Not verified — UNVERIFIED

- No browser has rendered any of these five screens. Nothing here says the dashboard bento collapses
  correctly at 768px, that the account-card dividers land where the old sibling selector put them,
  or that the consent checkmark is centred.
- `vite build` was **not** run. The three parallel batches leave `src/features/admin/`,
  `src/features/support/` and `src/ui/recipes/layout.ts` non-compiling while they work, so a build
  now would fail for reasons unrelated to this batch. It must run once all sixteen conversions land:

```
cd frontend_stack_ts && npx tsc -p tsconfig.json --noEmit && npm run lint && npm test && npm run build
```

- Then, read at 390px and 1512px on the deployed stack: `/dashboard`, `/portfolio`, `/activity`,
  `/funds/<fundId>/invest`.



## Tailwind v4 conversion — funds, sip, payments

One of four parallel, disjoint slices of the remaining CSS-module conversion in
`frontend_stack_ts/src/features/`. Full narrative in
`TASK/012-tailwind-batch-funds-sip-payments.md`.

### Changed

- Converted `FundListScreen.tsx`, `FundDetailScreen.tsx`, `FundTable.tsx`, `SipListScreen.tsx`,
  `SipDetailScreen.tsx`, `SipStartScreen.tsx`, `PaymentStatusScreen.tsx`,
  `PendingPaymentRecovery.tsx`.
- Deleted `Funds.module.css`, `FundTable.module.css`, `Sip.module.css`, `Payments.module.css`.
  No `styles.` reference remains in the three directories.
- Added per-feature recipes: `funds/funds.recipe.ts`, `sip/sip.recipe.ts`,
  `payments/payments.recipe.ts`.
- Added to shared recipes: `HONESTY_TEXT` (`ui/recipes/text.ts`), `CARD_LINK`
  (`ui/recipes/surface.ts`), `ACTION_ROW` (`ui/recipes/layout.ts`).

### Why the shape it has

The fund list's responsive split is preserved exactly: a real sortable `<table>` at `lg` and cards
below, decided in TypeScript by `isCompact(useBreakpoint())`, never by CSS. It was not converted to
an auto-fit grid.

Every rupee figure on these screens already routed through `MoneyValue`, so D-029 holds by
construction — `grep -rn font-mono` over the three directories returns nothing.

`.sortActive` and `.headButtonActive` were `composes:` duplicates sitting on elements that already
carried a correct `aria-pressed`. Both now derive from the `aria-pressed:` variant, so the class
cannot drift from the attribute a screen reader reads.

`FundTable`'s wrapper hardcoded `--be-squircle-lg` + `--be-shell-pad` with no `lg:` step while
`Card` steps to `--be-squircle-xl` + `--be-shell-pad-lg` at 1024px. Since the table only renders at
1024px and above, its bezel was permanently one size out of step with every card on the same page.
It now composes `SHELL` and mirrors `CARD_BASE`'s `calc()` radius.

One deliberate visual change: the SIP summary cells were bare `<div>`s holding two inline `<span>`s
with no flex-column, so a 10px uppercase label rendered flush against its value (`DEBIT DAY15`).
They now use `STAT_ROOT`, the same recipe `DataList`'s `Stat` uses.

### Verified — TESTED

- `npx tsc -p tsconfig.json --noEmit` — zero errors in `features/{funds,sip,payments}` and
  `ui/recipes/`.
- `npx eslint src/features/funds src/features/sip src/features/payments src/ui/recipes` — clean.
- `npx vitest run` — 8 files, 110 tests pass.
- `npx vite build` — succeeded, and the emitted stylesheet was read to confirm the new utilities
  generate rules: the four `aria-pressed:` variants, `group-last:border-b-0`, `bg-sand/32`,
  `bg-sand/22`, `size-[9px]`, `max-w-[64ch]`, `md:grid-cols-4`, `border-rule-strong`, `text-2xs`.
  Cascade order was checked by byte offset, not assumed: base colour utilities precede their
  `aria-pressed:` overrides, and `.border-b` precedes `.group-last\:border-b-0`.

### Not verified — UNVERIFIED

- No browser has rendered any of these screens. The 1024px card/table flip, the table's column
  behaviour at exactly 1024px, the pressed sort-pill contrast, the row hover tint and the SIP
  summary change above are all unobserved.
- The payment status polling row needs a genuinely open PhonePe payment, not a fixture.
- On the VPS: `cd frontend_stack_ts && npx tsc -p tsconfig.json --noEmit && npm run lint &&
  npm test && npm run build`, then read `/funds`, `/funds/<fundId>`, `/sips`, `/sips/<sipPlanId>`,
  `/funds/<fundId>/invest/sip`, `/activity/payments/<paymentId>` at 390px and 1512px.


---

## Tailwind v4 conversion — profile, statements, notifications, support, device security, legal, email verification

Batch 3 of the four parallel CSS-module conversions. Seven stylesheets, 539 lines of CSS, ten
components.

### What changed

- Converted `ProfileScreen.tsx`, `StatementsScreen.tsx`, `NotificationsScreen.tsx`,
  `SupportScreen.tsx`, `DeviceSecurityScreen.tsx`, `PinPad.tsx`, `LegalScreen.tsx`,
  `LegalDocumentScreen.tsx`, `GrievanceScreen.tsx`, `EmailVerificationScreen.tsx`.
- Deleted `Profile.module.css`, `Statements.module.css`, `Notifications.module.css`,
  `Support.module.css`, `DeviceSecurity.module.css`, `Legal.module.css`,
  `EmailVerification.module.css`. No `styles.` reference remains in the seven directories.
- Added per-feature recipes: `profile.recipe.ts`, `statements.recipe.ts`, `support.recipe.ts`,
  `notifications.recipe.ts`, `device-security.recipe.ts`, `legal.recipe.ts`.
- Added to shared recipes: `META_ROW`, `REFERENCE_TEXT`, `SUBHEAD_TITLE`, `COUNT_TEXT`
  (`ui/recipes/text.ts`); `ITEM_TITLE`, `ITEM_HINT`, `PROSE_SM`, `PROSE_PRE`, `ENTRY_ROW`,
  `ENTRY_TEXT`, `ENTRY_GLYPH` (`ui/recipes/datalist.ts`); `INSET_NOTE` (`ui/recipes/surface.ts`);
  `STACK_SM`, `STACK_LG`, `ROW_BETWEEN`, `ROW_BETWEEN_BASELINE`, `GRID_COLS_MD`
  (`ui/recipes/layout.ts`).

### Defects found in the CSS being replaced

- **Three dead rules.** `EmailVerification.module.css` `.statusRow` and `.statusLabel` had no
  consumer at all; neither did `Profile.module.css` `.build` or `Statements.module.css` `.note`.
  Four rules, 27 lines, styling nothing. They are not carried forward.
- **`Profile.module.css` and `Legal.module.css` were the same file twice.** `.hub`/`.grid`,
  `.entryLink`, `.entry`, `.entryText`, `.entryTitle`, `.entryHint` and `.entryGlyph` were
  byte-identical in both apart from one `max-width` (46ch vs 52ch), and both screens declared their
  own identical `Chevron` component. That is now one `ENTRY_*` vocabulary plus a `max-w-[…]` at the
  two call sites, so the divergence that remains is visible rather than buried in two stylesheets.
- **`Statements.module.css` `.label` wrote `font-size: 10px` raw**, while `--text-2xs` already
  exists in `theme.css` for exactly that size — and the rule was otherwise identical to the
  existing `STAT_LABEL` recipe. It now composes `STAT_LABEL`.
- **Three near-identical `.meta` rows** across notifications, support and legal (`docMeta`) with
  three different gap pairs and inconsistent `align-items`. Unified as `META_ROW`.
- **`DeviceSecurity.module.css` carried a `prefers-reduced-motion` block that only disabled a
  transition**, which `ui/styles/base.css` already forces globally. Deleted per the spec.

### Why the shape it has

`PinPad`'s `.key` box-shadow was `inset 0 0 0 1px var(--be-hairline-strong), var(--be-inner-lift-soft)`
— character-for-character the existing `ring-inset-hairline-strong` utility in `ui/styles/status.css`.
Reused rather than re-expressed as an arbitrary shadow, which is the difference between one owner of
that shadow and two.

The `.pad` grid, key sizing, dot indicators and prompt went into
`features/device-security/device-security.recipe.ts` rather than a shared recipe. A numeric keypad is
not a pattern another feature will grow; the avatar, contact list and statement flow grid are the same
judgement.

`ROW_BETWEEN_BASELINE` duplicates the string held by `SECTION_HEAD_ROW`. Kept separate deliberately:
`SECTION_HEAD_ROW` describes a section header's title/actions row and is consumed by `Section.tsx`.
A statement card's month/date-range row is a different concept that currently happens to need the
same three utilities, and collapsing them would couple two unrelated things through a shared name.

Both feature grids used `@media (min-width: 768px)`, which is `md`, while the existing `GRID_COLS`
record starts at `sm` (480px). Rather than silently move the breakpoint to make an existing constant
fit, `GRID_COLS_MD` was added beside it. Two entry cards side by side at 480px is a worse layout, not
a neutral one.

### Reconciling with the parallel batches

Per the lesson recorded in `risk_and_decision.md`, `src/ui/recipes/` was re-read after the feature
work rather than trusted from the start, and four collisions with concurrently-added constants were
resolved by deleting the local one:

| Added here | Kept instead | Where |
|---|---|---|
| `ACTION_ROW` (`flex flex-wrap gap-2 pt-1`) | `ACTION_ROW` (`flex flex-wrap gap-2`) + `pt-1` at the one call site | `layout.ts` |
| `ENTRY_LINK` | `CARD_LINK` | `surface.ts` |
| `PROSE_RELAXED` | `HONESTY_TEXT` | `text.ts` |
| `STACK_MD` | `CARD_STACK` | `surface.ts` |

Only the first was a hard TypeScript redeclaration; the other three were silent value-identical
duplicates found by diffing every `export const` body across `ui/recipes/`. That check is worth
keeping in the loop — a redeclaration fails the build, a synonym does not.

### Verified — TESTED

Repo-wide runs were taken at a moment when all four parallel batches were momentarily consistent. The
admin batch has since resumed editing `ui/recipes/admin.ts`, so a repo-wide typecheck now reports
errors in `features/admin/**` belonging to that batch. The scoped runs were re-taken afterwards.

- `npx tsc -p tsconfig.json --noEmit` — zero errors in the seven directories and in `ui/recipes/`,
  re-confirmed after the admin batch resumed; zero repo-wide at the consistent point.
- `npx eslint` over the seven directories and `ui/recipes` — clean; `npx eslint src` clean repo-wide at
  the consistent point.
- `npx vitest run` — 8 files, 110 tests pass, including `src/ui/tokens/safeArea.test.ts`.
- `npm run build` — succeeded; `check-bundle-boots` evaluated 7 chunks with no error.
- `npm run build:client` — succeeded; `check-android-dist` passed for the client variant, 16 assets,
  810,161 bytes.
- The emitted stylesheet was read to confirm the new utilities generate rules rather than nothing:
  `transition-duration:var(--be-dur-fast)`, `scale:.96`, `letter-spacing:-.015em`,
  `letter-spacing:.06em`, the `160deg` avatar gradient, `inset 0 0 0 1.5px var(--be-hairline-strong)`,
  `max-w-80`, `min-w-32`, `size-14`, `overflow-wrap:anywhere`, `md:grid-cols-4`, `color:inherit`, and
  the `before:content-['']` unread dot. Two of these were initially read as absent — the minifier
  strips the leading zero from `0.96` and `-0.015em`, so the first grep was wrong, not the CSS.
- No `#hex`, `rgb(`, `env(safe-area-`, `2xl:`, `ease-in-out`, or source comment appears in any
  converted file.

### Not verified — UNVERIFIED

- No browser has rendered any of these ten components. Specifically unobserved: whether the 56px
  gold initials avatar centres its glyph, whether the statement flow grid reads correctly at exactly
  768px, whether the unread gold dot aligns with the notification title's midline, and whether the
  pin key's `active:` press feels the same at 120ms as the original transition did.
- The `PinPad` has not been touched on a device. It is the one component here whose only real test is
  a thumb.
- On the VPS: `cd frontend_stack_ts && npx tsc -p tsconfig.json --noEmit && npm run lint &&
  npm test && npm run build`, then read `/profile`, `/statements`, `/notifications`,
  `/profile/support`, `/profile/security`, `/profile/legal`, `/profile/legal/investor-charter`,
  `/profile/legal/grievance`, `/profile/email-verification` and `/verify-email` at 390px and 1512px.


## Tailwind v4 conversion — the admin console (`features/admin/`)

Third of four parallel slices of the remaining CSS-module conversion. This slice owned
`features/admin/` and nothing else. Task file: `TASK/014-tailwind-batch-admin-console.md`.

One stylesheet, `admin/shared/Admin.module.css` (354 lines), read by 29 files across thirteen admin
domains. Deleted. Its vocabulary now lives in a new `src/ui/recipes/admin.ts` rather than a
per-feature recipe file, because it was never one feature's stylesheet: `mandates/`, `refunds/`,
`payments/`, `emails/`, `app-config/`, `applications/`, `audit/`, `fund-aum/`, `client-values/`,
`receipts/`, `users/`, `content/`, `overview/`, `funds/` and `shared/` all read it. Putting it under
any one of them would have made the other thirteen import across a sibling feature boundary.

The money rule needed care here rather than holding by construction. The stylesheet had a class
called `.mono` that was not monospace — it was `--be-font-numeric` with `tabular-nums lining-nums`,
the money treatment under a name that says the opposite — and it carried the rupee figures on the
mandate list and mandate detail screens. It now composes `MONEY_BASE` as `ADMIN_FIGURE`. The one
genuine monospace class, `.code`, carried only identifiers; all 22 of its call sites were listed and
read to confirm none is an amount. `grep -rn 'font-mono' src/features/admin` returns nothing.

Four rules in the stylesheet were dead: `.list`, `.hint`, `.error` and `.previewTotals` had no call
site in any of the 29 importers. Two pairs were byte-identical duplicates: `.counts`/`.meta` and
`.code`/`.basis`. `.jsonArea` set `color: #f1ede4`, the only raw hex in the file, now
`text-parchment`. `.select` and `.textarea` were hand-rolled duplicates of `SELECT_BASE` and
`TEXTAREA_BASE`; the two raw `<select>`s and two raw `<textarea>`s in `FundTermsForm` now use the
recipes, and stay raw elements rather than becoming `Select`/`Textarea` primitives, which would have
changed the DOM.

`.filterActive` was a `composes:` duplicate chosen by a ternary on four elements that already carried
a correct `aria-pressed`. All four now derive from the `aria-pressed:` variant, so the class cannot
drift from the attribute. Cascade order was read out of the emitted CSS by byte offset:
`aria-pressed:text-fg-inverse` follows `hover:text-fg` at equal specificity, so a pressed chip does
not go dark-on-dark under the cursor.

Nine constants written early in this slice were deleted again at the end of it, because the three
sibling slices had meanwhile added the same patterns to the shared layer. The admin screens now
import `ACTION_ROW`, `STACK_LG` and `ROW_BETWEEN_BASELINE` from `layout.ts`, `CARD_LINK` from
`surface.ts`, `ITEM_TITLE`, `ENTRY_TEXT` and `PROSE_SM` from `datalist.ts`, and `META_TEXT` and
`REFERENCE_TEXT` from `text.ts`. See the decision log for why that had to be a second pass.

One duplicate is knowingly left in place: `STATE_REFERENCE` in `state.ts` is string-identical to what
`ADMIN_CODE` needs. It was not consolidated because `state.ts` is owned by another slice's working
tree in this round. The follow-up is to fold both into one shared mono-identifier constant in
`text.ts` once the four slices have landed.

### Verified — TESTED

- `npx tsc -p tsconfig.json --noEmit` — zero errors.
- `npx eslint src/features/admin src/ui/recipes` — clean.
- `npx vitest run` — 8 files, 110 tests pass.
- `npx vite build` — succeeded, and the emitted stylesheet was read to confirm the unusual utilities
  generate rules rather than being dropped: `aria-pressed\:bg-ink[aria-pressed=true]`,
  `.sm\:\[\&\>\*\]\:flex-1>*{flex:1}`, `last\:\[\&\>td\]\:border-b-0:last-child>td`,
  `min-width:42rem`, `tab-size:2`, `hover:underline-offset-[3px]`.
- `grep -rn 'styles\.' src/features/admin` — nothing.

### Not verified — UNVERIFIED

- No browser has rendered any of the 29 admin screens. The `AdminTable` sideways scroll at 390px
  (`min-width: 42rem` inside `overflow-x-auto`), the pressed-filter contrast, the row hover tint,
  `ADMIN_JSON_AREA`'s light-on-espresso text and gold focus ring, and the 480px step in
  `ADMIN_CONTROLS` are all unobserved.
- Three reuse substitutions are close but not pixel-identical to what they replaced: `PROSE_SM` for
  `.note` (64ch/`leading-normal` vs 68ch/`leading-relaxed`, 13 call sites), `META_TEXT` for `.faint`
  (adds `leading-normal`, 14 call sites), `REFERENCE_TEXT` for `.slug` (adds `tracking-[0.06em]`,
  1 call site).
- `MandateListScreen` and `MandateDetailScreen` still format rupees with a local
  `Intl.NumberFormat({ maximumFractionDigits: 0 })` instead of `MoneyValue`. Deliberately untouched —
  switching would change the rendered text — but it means two admin screens format money differently
  from every other screen in the app.
- On the VPS: `cd frontend_stack_ts && npx tsc -p tsconfig.json --noEmit && npm run lint && npm test
  && npm run build`, then read `/overview`, `/applications`, `/users`, `/funds`, `/funds/new`,
  `/funds/<fundId>`, `/funds/<fundId>/holdings`, `/aum`, `/aum/collective`, `/funds/<fundId>/aum`,
  `/client-values/individual`, `/client-values/collective`, `/receipts`, `/refunds`, `/payments`,
  `/mandates`, `/emails`, `/audit`, `/content/faqs` and `/app-config` at 390px and 1512px.


## Entry 019 — Tailwind v4, the recipe layer, a real page audit, and the Android seam

2026-08-29. The styling foundation was replaced, every page was rendered and checked for the first
time, and the one genuine native defect that survived was found and fixed.

### What changed

**All 35 CSS Modules are gone.** `find src -name '*.module.css'` returns nothing. The replacement is
three layers: `src/ui/tokens/` holds tokens only and no longer contains a single selector;
`src/ui/styles/` holds one entry plus `base`/`patterns`/`utilities`/`status` in a declared cascade;
`src/ui/recipes/` holds the typed class vocabulary, where each pattern is declared once and imported
rather than re-derived. `theme.css` bridges the two with `@theme inline`, so every utility compiles to
`var(--be-*)` and the token layer stays the live source of truth. See D-033.

The feature conversion ran as four parallel slices over disjoint directories, against a written spec.
The slices are logged above; this entry records what came after them.

**Deduplication the compiler could not see.** The slices independently created value-identical
constants under different names in different files — invisible to `tsc`, `eslint`, the tests and the
emitted CSS. Twenty-five duplicate groups were reduced by folding the genuinely-same concepts
(`FUND_NAME`/`POOL_NAME`/`SIP_STRONG`/`PAYMENT_RECOVERY_TITLE` → `ITEM_TITLE`, and so on) and the two
shells onto a shared `APP_SHELL`. What remains is trivial layout coincidence (`flex flex-col gap-3`),
where forcing a shared name would couple unrelated components.

`recipes.test.ts` now enforces this: one declaration per name, no two names sharing a non-structural
class string, no `env()`, no hex literal, only the four canonical breakpoints, and no stale allowlist
entry. The six deliberate coincidences each carry a machine-checked reason string.

### The page audit

`test_e2e/frontend-ts-audit.mjs` discovers routes from the route manifests, resolves dynamic segments
from live links, and renders every route at 390, 834 and 1440 px on both variants — 141 page audits.
Per page it checks console errors, page errors, failed requests, blank render, `h1` presence and
count, document-level horizontal overflow, elements past the right edge, money in a monospace family,
touch targets under 44 px, duplicate nav landmarks and unnamed buttons.

It found real defects and now reports none. `admin/app-config` overflowed horizontally at 390 px
because `LIST_VALUE` was `flex-none`, so a long config value could neither shrink nor wrap. Three
controls sat below the 44 px touch floor on mobile despite `--be-target-min` existing for exactly that
purpose: the amount preset chips, the client Activity tabs and the admin section-pages strip. Each now
takes 44 px on touch and drops to 36 px only from `lg`.

Three checks had to be taught what is intentional rather than broken: `AdminTable` is
`min-w-[42rem]` inside an `overflow-x-auto` bezel and is *supposed* to scroll sideways on a phone;
desktop nav links are 36 px by design, because `--be-target-compact` is the pointer-sized token; and
text links inside table cells cannot be 44 px without wrecking table density.

### The Android seam

The status bar showed a 132 px band in a different colour from the page. The cause was not a bug in
the app's inset handling. `SystemBars` — a core plugin bundled inside `@capacitor/android`, not a
separate package, so its config block was always valid — takes a documented fallback on WebView below
140: it pads the WebView's parent natively and sets the injected `--safe-area-inset-*` to zero, because
Chromium's `env()` values are wrong on those versions. This emulator runs WebView 133. On the fallback
path the inset strips are painted with the window background, and the window background was pinned to a
colour no screen actually uses. Fixed in D-034.

The token layer already matched the official recommendation byte for byte
(`var(--safe-area-inset-top, env(safe-area-inset-top, 0px))`), so no third-party safe-area or
edge-to-edge plugin was needed.

### Dependencies

Capacitor moved 8.3.4 → 8.5.0 (core, cli, android) with `app`, `browser`, `local-notifications` and
`capacitor-native-biometric` to current, all pinned exact. Nothing was incompatible; the stack was
merely trailing. The plugin count stays five, because `SystemBars` is core and not allowlisted.

### Verified — TESTED

- `npm run check` — typecheck, `eslint .`, 10 files / 122 tests, `generate:api:check`, both variant
  builds, `check-phonepe-native-target`. All clean.
- `check-bundle-boots` — 7 chunks, no error. `check-android-dist` — client 810,421 B, admin
  828,393 B. CSS 84.26 kB.
- `packages/contracts` `check-frontend-contract-bypass` — 94 operations, no bypass.
- `test_e2e/frontend-ts-smoke.mjs` — 71/71. The money chain still reads exactly `₹51,25,000`.
- `test_e2e/frontend-ts-audit.mjs` — 141 page audits, 0 errors, 0 warnings. It demonstrably fails:
  its first run reported 7 errors and 303 warnings.
- `runtime_contract`, `hermetic_branding` (13 checks), `apk_logging_policy` (12 checks) — pass.
- Both new guards were negative-tested rather than assumed: injecting a duplicate constant, a hex
  literal and a `2xl:` prefix failed exactly the three intended assertions in `recipes.test.ts`, and
  reverting `colors.xml` to `#F7F7F5` failed exactly the Android assertion in `launchColour.test.ts`.
- `assembleRelease` for both variants — `minifyReleaseWithR8`, `convertShrunkResourcesToBinaryRelease`
  and `optimizeReleaseResources` all ran, BUILD SUCCESSFUL. Client 2,312,387 B, admin 2,307,119 B
  against 8,666,647 B debug. **R8 had never been run against this stack before**, because
  `minifyEnabled` is on the release build type only and the project only ever built debug.

### Verified — on device (emulator-5554, WebView 133, SDK 36)

- The seam is gone. Pixel probes read `srgba(244,241,233)` in both the status-bar and nav-bar strips,
  equal to `#F4F1E9`, against `srgba(240,235,226)` for the page just below.
- Client and admin both launch to `topResumedActivity=com.beonedge.app/.MainActivity` with no FATAL
  and no token in logcat. Admin shows `ADMINISTRATOR CONSOLE` where client shows `CLIENT ACCESS`.
- With the backend unreachable the app degrades honestly — "We cannot reach BeOnEdge", with a Try
  again button — rather than painting a blank screen.
- Landscape rotation survives with no FATAL. Back on the root screen exits to the launcher.

### Not verified — UNVERIFIED

- The true edge-to-edge passthrough path. It requires WebView ≥ 140 and this emulator has 133, so the
  branch that populates `--safe-area-inset-*` with real values has never executed here. On a device
  with a current WebView, confirm the page paints under the bars and that
  `getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-top')` is non-zero.
- R8 at runtime. The release APKs are unsigned, so nothing was installed from them. A signed build
  must be launched and its plugin calls exercised before trusting minification.
- Keyboard resize on the login inputs, the remaining Back rules beyond root-exit, the recents
  thumbnail (`setRecentsScreenshotEnabled(false)` is present in `MainActivity` but the preview was
  never observed), the biometric prompt, and APK self-update SHA-256 verification.
- Anything requiring money to move. No PhonePe credentials exist locally, so AutoPay authorisation and
  a completed payment remain unexercised, and the admin refund, mandate and support-ticket screens were
  audited empty because no such rows exist.
- `docker build` has still never been run for this frontend.

### Follow-ups

- `MandateListScreen` and `MandateDetailScreen` format rupees with a local `Intl.NumberFormat` instead
  of `MoneyValue`, so two admin screens format money differently from every other screen.
- `check-android-dist.mjs` matches its cross-target patterns against asset *names* only, never
  contents, so it has never actually verified leakage. See D-035.
- `TASK/README.md` omits entries 005 onward.


## Entry 020 — the mandate redirects could strand a user, and status exhaustiveness was fiction

2026-08-29. Two audit findings closed. Both were defects of omission that every green gate had missed,
because neither typecheck nor `vitest` nor the page audit can see a redirect that leaves the app.

### Defect 1 — persist-verify-abort was applied to one redirect out of three

Doc 07 payment safety rule 4 requires the pending record to be written **and the write verified**
before navigating to a provider checkout URL, aborting the checkout if the write fails.
`LumpsumInvestScreen` did this. The two AutoPay mandate redirects did not:
`SipStartScreen` (`window.location.assign` after `startAutoPaySip`) and `SipDetailScreen`
(the same after `retryAutoPaySetup`). `PendingPaymentRecovery` is the only recovery mechanism in the
app, and it reads that record — so a user who left for PhonePe from either screen came back to nothing.

`persistPendingPayment` is now called on both paths, with the same abort-on-failure shape as the
reference implementation. The existing helpers are reused; no second store and no second key.

The record needed one honest extension. A mandate authorisation and an order payment are not the same
event and must not recover to the same place: `PendingPayment` is now a discriminated union on `kind`,
`"order_payment"` carrying what it carried before, `"mandate_setup"` additionally carrying `sipPlanId`.
`PendingPaymentRecovery` routes `mandate_setup` to `/sips/{sipPlanId}`, where the mandate state is
authoritative, rather than to a payment screen whose failure affordance is "Try again" into the lump-sum
flow. Existing order-payment copy and destination are byte-identical. See D-036.

A record written by an older build has no `kind` and is now discarded as unrecognised rather than
misread. That is forward-only and costs at most one 30-minute recovery banner.

Both SIP screens' `failure` state grew a title, because the static alert titles lie about this branch:
by the time the write fails the SIP plan and the setup attempt exist, so "Nothing was created" and
"Nothing changed" would be false. Every pre-existing message keeps its previous title verbatim.

Persist happens on the redirect branch only. The `checkout: null` poll branch stays as it was: it never
leaves the app, and unlike the lump-sum poll path it lands on the plan screen, which has nothing that
would ever clear the record.

### Defect 2 — `domain/status.ts` proved exhaustiveness over its own copy

Doc 07 promises that adding a backend status is a compile error. It was not. All sixteen unions were
hand-written string literals, structurally identical to the contract enums and completely disconnected
from them, so `assertNever` only ever proved the file was exhaustive over itself.

Each union is now derived from the contract: `z.infer` aliases re-exported under the existing names
(`ClientInvestmentStatus`, `SipState`, `MandateState`, `MandateSetupState` from the client operations;
`AdminOrderState`, `AdminPaymentState`, `AdminRefundState`, `AdminReceiptState`, `AdminUserAccountState`,
`AdminApplicationState`, `AdminEmailDeliveryState`, `AdminFundState` from the admin ones;
`EmailVerificationStateValue` and `FundSummary["riskLevel"]` from the client contract;
`SupportRequestState` from client-account). `SipCollectionMode` has no named contract enum — the
contract declares it inline — so it is derived positionally as
`AdminMandateDetailData["sip"]["collectionMode"]` rather than left as a copy.

The presentation mappings are untouched. Only the type source changed, and the import is `import type`,
so no additional zod schema is pulled into the bundle.

### Verified — TESTED

- `npx tsc -p tsconfig.json --noEmit` — clean.
- `npx eslint .` — clean.
- `npx vitest run` — 12 files, 134 tests, all passing (122 before; three new pending-record branches
  plus the percentage work logged separately).
- `VITE_BEO_APP_TARGET=client npx vite build` — built, `app` chunk 216.78 kB, CSS 84.26 kB unchanged.
- The exhaustiveness guarantee was **negative-tested, not assumed**. Adding a `hibernating` member to
  the contract `SipState` produced exactly `src/domain/status.ts(155,26): error TS2345: Argument of type
  '"hibernating"' is not assignable to parameter of type 'never'.` The edit was reverted and typecheck
  re-run clean. Before this change the same edit produced no error at all.

### Not verified — UNVERIFIED

The redirect itself. Nothing here proves the abort path fires on a real device, because that needs a
`localStorage` write to actually fail, and nothing proves the recovery banner routes correctly after a
real mandate authorisation, because that needs PhonePe credentials this machine does not have. On the
VPS, with AutoPay configured: start a mandate from `SipStartScreen`, leave for PhonePe, return, and
confirm the banner reads "You have a mandate authorisation in progress" and opens `/sips/{sipPlanId}`.
For the abort path, fill the origin's storage quota (or deny storage for the origin) and confirm the
button surfaces "We stopped before the mandate page" and no navigation occurs.

Also unverified: that `mandate_setup` recovery is the right destination *for the first installment*.
The backend creates a real `sip_installment` order and payment during setup, so that money is visible at
`/activity/payments/{paymentId}` too; the plan screen was chosen because the mandate is the thing the
user was authorising. Worth confirming against a real setup that the plan screen shows enough.


## Entry 021 — refresh tokens were in `localStorage` on web, a contract field disagreed, and three percentage formatters

Three audit findings between this blueprint and the tree, closed together. See D-037, D-038 and D-039.

### Defect 1 — the client web build persisted bearer secrets to `localStorage`

`shells/client/clientRuntime.ts` passed `persistSecrets: true` regardless of platform. The persistence
port is chosen by platform (`createSecureStoragePersistence()` on native, `createWebPersistence()`
otherwise) but the flag was not, so in a browser — which is a shipped configuration, `Dockerfile`
defaults `VITE_BEO_APP_TARGET=client` — `boe.client.accessToken` and `boe.client.refreshToken` were
written to `localStorage`. Any injected script could read a refresh token and mint sessions.
`shells/admin/adminRuntime.ts` had it right at `persistSecrets: false`.

`persistSecrets` is now `isNative()`. `purgeLegacyLocalSecrets()` moved out of the `if (native)` guard
so a browser holding leaked secrets from an earlier build is cleaned on next load. Nothing else changed:
the store already keeps every field in memory and consults `shouldPersist` per field, so on web the
tokens live in memory for the document's lifetime and `principal` still persists as it does for admin.

**Behaviour change.** The client *web* build no longer survives a reload — `restore()` finds a cached
principal but no access token, the refresh attempt has no refresh token, and the session resolves to
`anonymous`. Android is unaffected. There is no cookie session for the client scope to fall back on;
`web-auth` issues cookies for admin only. D-037 records the accepted consequence and why a client-scope
cookie refresh was not attempted here.

### Defect 2 — `emailVerificationStatus` versus `emailVerificationState`

`GET /v1/client/email-verification-status` returned `emailVerificationStatus`; the contract operation
`getEmailVerificationStatus` requires `emailVerificationState`, and the transport validates responses,
so the first caller would have taken a malformed-response failure. Latent only because
`useEmailVerificationStatus` has no consumer — `VerificationStatusScreen` reads `useEligibility()`.

The backend was the wrong side. Contracts, `db/types.ts`, the repositories, the eligibility payload and
doc 04 line 247 all use `emailVerificationState`. Both `sendData` calls in
`clientEmailVerificationRoutes.ts` were renamed — `/verify` too, whose contract is `z.looseObject({})`
and would have tolerated either name. No contract changed, so no regeneration; the bypass check still
reports 94 contracted operations. `admin-oversight` keeps `emailVerificationStatus` in its own contract
and route and was left alone. The hook was kept rather than deleted with its contracted operation (see
D-038), so it remains an unconsumed query.

### Defect 3 — three percentage formatters

`ui/charts/chartMath.ts::formatShare` (1 dp) plus hand-rolled `toFixed(2)` expressions in
`DashboardScreen` and `PortfolioScreen` — the legacy `formatReturnPct`/`fmtPct` split with an extra copy.
`formatShare` is deleted and `domain/percent.ts::formatPercent` is the only percentage formatter:
percentage number in, two fixed decimals, `—` for `null` and non-finite, `showSign` following
`formatINR`'s option name and its "+ only when strictly positive" rule. `DonutChart` converts its share
at the call site (`arc.share * 100`); `PortfolioScreen`'s local `percent` alias is gone.

**Behaviour change.** Donut legends and the donut `aria-label` render `42.31%` where they rendered
`42.3%`, and a return of exactly zero renders `0.00%` where it rendered `+0.00%`. Everything else is
byte-identical. Precision reasoning and what was deliberately left alone are in D-039.

### Verified — TESTED

From `frontend_stack_ts`:

- `npx tsc -p tsconfig.json --noEmit` — clean.
- `npx eslint .` — clean.
- `npx vitest run` — 12 files, 134 tests. Two new files: `src/domain/percent.test.ts` (5) covering
  precision, sign rule, absent marker and grouping, and `src/shells/client/clientRuntime.test.ts` (4)
  asserting that a browser runtime keeps secrets out of `localStorage`, purges secrets an earlier build
  left there, does not recover them on hydration, and that a stubbed native bridge receives them in
  Secure Storage instead.
- The three browser assertions were confirmed to fail against the pre-fix `persistSecrets: true` /
  `if (native) purge` code before the fix was restored, so they are a real regression guard.
- `VITE_BEO_APP_TARGET=client npx vite build` — built, `app` chunk 216.78 kB.

From `packages/contracts`: `npm run check:frontend-contract-bypass` — no bypasses, 94 contracted
operations. Contracts were not modified, so the rest of `npm run check` was not required.

From `backend_controller`: `npx tsc -p tsconfig.json` reports nothing under `src/`, `npx vitest run`
passes 74 files / 676 tests, and `npx eslint src/routes/clientEmailVerificationRoutes.ts` is clean.

### Not verified — UNVERIFIED

- **Nothing here proves a wire response.** The renamed field was never observed on a real response. On
  the VPS, against a verified client session:
  `curl -sS -H "authorization: Bearer $ACCESS" -H 'x-client-platform: android' -H 'x-app-version: 0.1.0' https://<host>/api/v1/client/email-verification-status | jq` — expect `emailVerificationState`, and no
  `emailVerificationStatus` key.
- **The web reload change was not observed in a browser.** Sign in to the deployed client web build,
  confirm `localStorage` holds no `boe.client.accessToken` or `boe.client.refreshToken`, then reload and
  confirm the app lands on sign-in rather than a broken authenticated shell.
- **Native Secure Storage still works.** The native test stubs the plugin. An APK must sign in,
  background, be killed and reopened to prove the token survives — `persistSecrets` is unchanged on
  native, but the purge now also runs there on every start and only device execution proves it touches
  `localStorage` alone.
- **The rendered percentages were not seen.** Fund detail sector allocation, admin fund holdings,
  dashboard and portfolio return cells were checked by type and test only, not on screen.



## Entry 022 — the app-update gate, a real device lock, and the Capacitor bridge nothing had ever registered

2026-08-30. Known gaps 2 and 3 from `README.md` closed, plus the wiring defect underneath both.

**Task:** [`TASK/018-app-update-gate-and-device-lock.md`](../TASK/018-app-update-gate-and-device-lock.md)
**Decisions:** D-040, D-041, D-042
**Scope:** `frontend_stack_ts/` only. `backend_controller/` and `packages/contracts/` untouched —
`GET /v1/app/update` and the `getAppUpdate` descriptor already existed and were read as given.

### The defect under the defects

`src/platform/capacitor.ts` reads `window.Capacitor.Plugins[name]`. That object is written by exactly
one function, `registerPlugin` in `@capacitor/core` (`dist/index.js:174`), and **nothing in `src/`
had ever imported `@capacitor/core` or any plugin package**. `@capacitor/android`'s injected
`native-bridge.js` does not populate `Plugins` from `PluginHeaders` — it only reads it, and warns
when `cap.Plugins.App` is missing. So on a device `Plugins` was `{}` and every native wrapper
resolved to `null`:

- `lifecycle.ts` — no `backButton`, `resume`, `pause` or `appStateChange` subscription ever
  attached, so `NativeBackCoordinator` was inert.
- `systemChrome.ts` — `applySystemChrome` was two silent `tryCallPlugin` no-ops.
- `openExternal.ts` — always the `window.open` fallback, never the in-app Browser.
- `secureStorage.ts` — `available()` false, so native token persistence had nothing behind it.

Entry 019's device run did not catch this because it could not: "Back on the root screen exits to
the launcher" is Capacitor's *default* behaviour when no JS `backButton` listener exists, and the
status-bar seam was fixed in `colors.xml`, not through the `SystemBars` call. Two green observations,
neither of which exercised the bridge.

`src/platform/plugins.ts` now registers `App`, `AppUpdate` and `NativeBiometric` and is called from
`main.tsx` before the shell chunk loads. Three explicit names rather than importing each plugin
package, for the reasons in D-040 — chiefly that `AppUpdate` has no npm package to import, and that
the web shims would start firing lifecycle events in browsers that have never had them.

### The app-update gate

`src/platform/appUpdate.ts` wraps the plugin in the existing style — `isNative()`, `callPlugin`,
`platformError` — with `readInstalledApp`, `canInstallUpdates`, `requestInstallPermission`,
`downloadUpdate`, `installUpdate` and `onDownloadProgress`.

The SHA-256 is now refused in three independent places. `installableRelease` returns `null` unless
the digest matches `/^[a-f0-9]{64}$/`; `downloadUpdate` throws `INVALID_ARGUMENT` before it reaches
the bridge; `AppUpdatePlugin.java` already rejected a missing `sha256`. The wrapper also compares
the digest the plugin echoes back against the one it asked for, and requires `https`.

`src/features/app-update/updateDecision.ts` is pure, and it does **not** treat `mandatory` as a
refinement of `updateAvailable`. The backend computes them from different inputs: `mandatory`
compares the running `version` against the published `minimumSupportedVersion`, `updateAvailable`
compares the running `versionCode` against the newest APK on the mount. `mandatory: true,
latest: null` is therefore reachable, and the blocking screen says so plainly rather than letting an
unsupported build through (D-042).

`src/app/native/AppUpdateGate.tsx` is mounted in both shell roots *inside* `ApiProvider` — it needs
the transport, and `AppProviders` is `ApiProvider`'s parent, not its descendant. Mandatory replaces
the children; optional renders the children plus a dismissible sheet keyed on `versionCode`, so
dismissing one release does not silence the next. The query is `enabled: canCheckForUpdates()` and
`retry: false`: a failed check must never block the app, or an unreachable server becomes
indistinguishable from a mandatory update.

### The device lock

`securityStore.ts` had hashed and verified a PIN since Phase 9 with no caller outside the settings
screen, and `@capgo/capacitor-native-biometric` sat in both allowlists imported by nothing, so the
biometric switch wrote a flag and promised a protection that did not exist.

`src/platform/biometric.ts` adds `readBiometricCapability()` — `isAvailable({ useFallback: false })`,
so a device PIN/pattern does not masquerade as an enrolled biometric — and `verifyBiometric()`,
which maps the plugin's error codes to `cancelled | unavailable | failed`. `DeviceSecurityScreen`
now offers the switch only when the device reports an enrolment, names the modality it found, and
switches a stale `on` flag back off when it finds none.

`lockDecision.ts::shouldLock` is the whole policy, pure and tested: never off-device, never without
an enrolment, always on cold start, and on resume once 120 s away is reached. Every case where the
time away cannot be established — no recorded departure, a non-finite timestamp, a clock that moved
backwards — locks rather than passes.

`deviceLock.ts` holds the state as a module-level store with subscribers, in the same shape as
`systemChrome.ts`, precisely so `NativeBackCoordinator` can consult it without a provider-order
dependency. The Back handler returns *before* `dismissTop()`, because the lock is deliberately not an
overlay-stack entry: registering it would have made hardware Back dismiss it, which is the exact
bypass the requirement names. The "I have forgotten this PIN" confirmation is inline for the mirror
reason — `ConfirmDialog` portals to `document.body` at `z-overlay` (900) and would have rendered
behind the lock layer at `z-toast` (1000).

`DeviceLockGate` sits above `ToastProvider` in `AppProviders` so its layer is last in the DOM and
wins the `z-toast` tie against the toast region.

The lock engages before the session resolves, so no authenticated frame is painted first; the
forgotten-PIN path removes the PIN and signs out locally, so that choice cannot brick an install
(D-041). The honesty copy is unchanged byte for byte and now appears on the lock screen too, read
from one place (`features/device-security/copy.ts`) instead of being duplicated.

### Verified — TESTED

From `frontend_stack_ts`:

- `npx tsc -p tsconfig.json --noEmit` — clean.
- `npx eslint .` — clean.
- `npx vitest run` — 15 files, 159 tests. Three new files: `updateDecision.test.ts` (11) covering
  mandatory-versus-optional, the unsatisfiable floor, and every reason a release is refused;
  `lockDecision.test.ts` (8) covering enrolment, platform, the threshold boundary in both
  directions, an explicit threshold, and the four unknowable-time cases;
  `plugins.test.ts` (5) asserting no bridged plugin is reachable before registration and all three
  are after.
- `VITE_BEO_APP_TARGET=client npx vite build` — built, `app` chunk 232.17 kB (was 231.08 kB before
  this entry), CSS 84.65 kB, `vendor` 8.19 kB now carrying `@capacitor/core`.
- `check-bundle-boots` — 7 chunks, no error. `check-android-dist --variant=client` — 16 assets,
  837,629 B, no cross-target leakage.
- `packages/contracts` `check:frontend-contract-bypass` — 94 operations, no bypass. No contract or
  generated-client change was needed; `getAppUpdate` was already generated and simply unused.
- The lifecycle guard was **negative-tested**: deleting `.catch(() => undefined)` from
  `lifecycle.ts::subscribe` makes `vitest run` exit 1 with four `UNIMPLEMENTED` unhandled
  rejections, because the bridge is now live in a browser too. Restored.

### Not verified — UNVERIFIED

Nothing here has run on a device, and this entry changes device behaviour more than it changes web
behaviour. Every item below needs an APK.

- **The whole update flow.** On the VPS, publish a client APK to the release mount and, from an
  installed older build: confirm the sheet appears, that `downloadUpdate` reports progress, that the
  file lands in `getCacheDir()/updates/update.apk`, and that the system installer opens. Then
  corrupt the published `sha256` in the sidecar and confirm the download **fails closed** with "The
  downloaded update could not be matched to the digest it was checked against" and that no installer
  opens. That last check is the only one that proves the point of this work.
- **The mandatory branch.** Publish `minimumSupportedVersion` above the installed build and confirm
  the app blocks before any authenticated screen paints. Then publish a floor no artifact satisfies
  and confirm the "nothing to download" copy with a working Check again.
- **`Install unknown apps` permission.** Revoke it for BeOnEdge and confirm the
  needs-permission branch opens the settings page and that "I have allowed it" then proceeds.
- **The biometric prompt.** Enrol a fingerprint, switch the toggle on, background the app past
  120 s, and confirm the prompt appears on resume and that cancelling it leaves the PIN pad usable.
  Then remove every enrolment and confirm the toggle is disabled with the unenrolled hint and that
  the stored flag is cleared.
- **The lock itself.** Cold start with a PIN set must show the lock with no dashboard frame behind
  it. Background for under 120 s and confirm no lock; over 120 s and confirm one. Press hardware
  Back on the lock screen and confirm nothing happens — this is the assertion `vitest` cannot make.
- **That `NativeBackCoordinator` now works at all.** It has never run. Doc 08's five Back rules
  should be walked through on device, because until this entry the coordinator was never reached and
  Capacitor's default was answering instead.
- **`applySystemChrome` and `openDestination` on device.** Both now issue real plugin calls for the
  first time. The status bar was already the right colour for a different reason (D-034), so a
  regression here would be invisible on the emulator that was used before.

### Follow-ups

- `secureStorage.ts` asks the bridge for `"SecureStoragePlugin"`. The package registers, and its
  Java class annotates, `"SecureStorage"`. The name has never matched, so native token persistence
  has never had a backing store. Not fixed here: it moves client bearer tokens on Android and wants
  its own task with a device. See D-040.
- The optional-update sheet can appear over the splash screen during session restore, because the
  feed query fires on mount. It is dismissible and honest, but a delay until the session resolves
  would read better.


## Entry 023 — cursor pagination end to end, and the cursor scalar that rejected every real cursor

Closes known gap 1 from `README.md`: `src/api/cursor.ts` had no consumer outside `api/envelope.ts`,
so every list in the product read one fixed page and stopped. Touches `backend_controller/`,
`packages/contracts/` and `frontend_stack_ts/`. Decisions: D-043, D-044, D-045. Task: `TASK/019`.

### The defect under the defect — `Cursor` could not match a cursor

`packages/contracts/src/scalars.ts` defined

```
export const Cursor = z.string().regex(/^[A-Za-z0-9_-]{16,1024}$/u)
```

but `backend_controller/src/http/cursor.ts` mints `base64url(payload).base64url(HMAC)` — one dot,
always. The alphabet class excludes `.`, so the scalar rejected every token the backend can produce.

This was not theoretical. `listClientFunds` and `listClientOrders` already declared
`createPaginatedSuccessEnvelopeSchema`, whose `meta.page.nextCursor` is `Cursor.nullable()`, and
`src/api/http.ts` parses the success envelope with `safeParse` and throws `TransportError("malformed")`
when it fails. So the moment a second page of funds or orders existed, the *first* page would have
failed contract validation and the screen would have shown an error state. It had never fired because
neither list has yet exceeded 25 rows in any environment this ran in. Fixed to
`/^[A-Za-z0-9_-]{16,1024}[.][A-Za-z0-9_-]{16,1024}$/u`, with the scalar test rewritten to assert the
two-part shape and to reject a bare body, a short half, and a three-part token.

### One paginator, not seven

`paginate`/`readKeyset`/`readKeysetValues` lived in `routes/adminRouteKit.ts`, and
`routes/adminIdentityRoutes.ts` carried a second private copy while `clientPortfolioRoutes.ts` and
`clientCatalogRoutes.ts` open-coded the same over-fetch inline. Doc 04 already flagged the
`requireIdempotencyKey` quadruplication; this was the same shape one layer down.

They now live in `src/http/pagination.ts` alongside `MAX_PAGE_LIMIT`/`DEFAULT_PAGE_LIMIT` and a
`createdAtKeyset` projection, and the seven route modules import from there. `adminRouteKit` re-exports
nothing of it and `MAX_ADMIN_LIMIT` is now derived from `MAX_PAGE_LIMIT` rather than a second literal
`100`. `adminIdentityRoutes`' duplicate is deleted.

### Defect — the mandate list could never report a next page

`adminMandateRoutes.ts::listMandates` passed `limit: query.limit` to the repository, but
`adminMandateRepository.listMandates` was itself appending `+ 1` to the SQL limit. `paginate` then
compared `rows.length > limit` against a row set that had *not* been over-fetched from its own point
of view — the extra row existed, so `hasMore` happened to work, but the two halves disagreed about
whose job the over-fetch was, and the repository's contract was invisible at the call site. The
repository now takes the caller's budget verbatim, like every other list repository in the codebase,
and the route asks for `limit + 1`.

The same route also emitted `page` inside `data`, alone among nine admin lists that put it in
`meta.page`. Moved to `meta`, contract and integration test with it.

### What now pages

Backend routes that gained the opaque cursor (`after` query param, `meta.page` response, keyset
predicate in SQL, all parameterised):

| Route | Sort tuple | Filters bound into the cursor |
| ----- | ---------- | ----------------------------- |
| `GET /v1/client/transactions` | `(created_at, id) desc` | userId |
| `GET /v1/client/notifications` | `(created_at, id) desc` | userId |
| `GET /v1/client/payments` | `(created_at, id) desc` | userId, resolved states, success projection |
| `GET /v1/client/support/tickets` | `(created_at, id) desc` | userId |
| `GET /v1/admin/fund-receipts` | `(created_at, id) asc` | state |
| `GET /v1/admin/refunds` | `(created_at, id) desc` | state |
| `GET /v1/admin/payments` | `(created_at, id) desc` | none |

Already paged on the backend and left alone: admin applications, application deliveries, email
deliveries, users, per-user login events, audit log, FAQs, funds, AUM history, mandates, client funds,
client orders.

Three client repositories gained keyset parameters (`clientAccountRepository`,
`clientValueEntryRepository`). The three admin repositories already accepted `afterCreatedAt`/`afterId`
— only their routes were ignoring them.

`GET /v1/client/notifications` previously computed `unreadCount` by filtering the rows it had just
returned. Under pagination that would have meant "unread in this page", so it is now a `COUNT(*)`
over the account. See D-045.

### The frontend: one hook, one affordance

`src/api/paged.ts` — `usePagedQuery` over TanStack `useInfiniteQuery`. `queryKey` must carry every
active filter, which is what makes a filter change start a fresh chain rather than append to a cursor
the backend will refuse; `getNextPageParam` is the existing `nextPageParam(meta.page)`; `mergePages`
concatenates `items` and keeps page one's sibling fields (`unreadCount`, `summary`) because those
describe the whole set, not the page. The returned object is structurally an `AsyncQuery`, so every
`AsyncBoundary` call site type-checks unchanged and the **existing refreshing affordance appears while
the next page is in flight** — `isFetching` is true during `fetchNextPage`.

`src/ui/patterns/LoadMore.tsx` is the only Load more in the product. It renders nothing when
`hasMore` is false and otherwise states `Showing the first N <noun>. There are more.` above the button,
so a partial list is never presented as a complete one. Classes come from `LOAD_MORE_ROOT` (new, in
`recipes/state.ts`) and the existing `META_MUTED`; a `LOAD_MORE_NOTE` was written and then removed
because `recipes.test.ts` forbids two names for one class string and `META_MUTED` already was it.

Page size is now 25 everywhere it used to be 100.

### Verified — TESTED

From `frontend_stack_ts`:

- `npx tsc -p tsconfig.json --noEmit` — clean.
- `npx eslint .` — clean.
- `npx vitest run` — 16 files, 165 tests. New: `src/api/paged.test.ts` (6) covering the first read
  with no cursor, appending page two at the cursor the server gave, the filter reset, `mergePages`
  field precedence, and `clampPageLimit`.
- The filter-reset test was **negative-tested**: replacing `queryKey: ["probe", filter]` with
  `["probe"]` makes exactly that test fail, so it is testing the thing it claims to.
- `VITE_BEO_APP_TARGET=client npx vite build` — built, `app` chunk 232.66 kB, CSS 84.65 kB.

From `packages/contracts`: `typecheck`, `lint`, `test:coverage` (95 tests), `build`, `test:exports`,
`lint:openapi` and `check:frontend-contract-bypass` all pass; the bypass gate reports 94 contracted
operations and 94 in the generated client. `generated/openapi-v1.{json,d.ts}` were regenerated and
`npm run generate` is idempotent against the committed sources.

From `backend_controller`: `npx tsc -p tsconfig.json --noEmit` clean including `test/integration/**`;
`npx eslint .` clean; `npx vitest run --exclude 'test/integration/**'` — 76 files, 726 tests. New:
`src/http/pagination.test.ts` (11) covering the over-fetch, the last page, the empty page, that the
cursor points at the last *kept* row, and that a cursor is refused across routes, across filter sets,
under another key, and when it carries no position; `src/routes/pagedQueries.schema.test.ts` (39)
running the same battery over all seven paged query schemas — default limit, cursor accepted verbatim,
empty cursor refused rather than silently read as page one, limit coercion and both bounds, and
`offset`/`page` rejected as unknown keys.

### Not verified — UNVERIFIED

No paginated route has been executed against PostgreSQL. `vitest run` does not touch SQL, and the
integration tests that would (`test/integration/**`) need testcontainers. Specifically unproven:

- **Every new keyset predicate.** They follow the pattern already shipping in `refundRepository` and
  `fundReceiptAcknowledgementRepository` — `(${ts}::timestamptz is null or (created_at, id) < (${ts}, ${id}))`
  — where the second placeholder is an untyped `null` on the first page and relies on PostgreSQL
  resolving each element of the row comparison against the column types. That inference is what makes
  the clause legal, and it has only been read, not executed, for `notifications`, `payments`,
  `support_requests` and `client_value_entries`.
- **That page two actually excludes page one.** Ordering and the comparison direction agree by
  inspection (`desc` with `<`, and `asc` with `>` for the receipt queue) but no query has run.
- **The `COUNT(*)` unread query.**
- **The mandate list's over-fetch change.** `adminMandate.integration.test.ts` asserts
  `hasMore === true` with `limit=1` and two mandates and now reads `meta.page`; it has not been run.

On the VPS, after deploying, this is the check that matters — it proves the cursor chain, the filter
binding and the refusal in one pass:

```
# a client bearer token in $T, against the deployed API base
curl -s -H "authorization: Bearer $T" "$API/v1/client/payments?limit=1" \
  | tee /tmp/p1.json | jq '{items: [.data.items[].id], page: .meta.page}'
C=$(jq -r '.meta.page.nextCursor' /tmp/p1.json)
curl -s -H "authorization: Bearer $T" "$API/v1/client/payments?limit=1&after=$C" \
  | jq '{items: [.data.items[].id], page: .meta.page}'
# the same cursor under a different filter must be refused, not silently restarted
curl -s -H "authorization: Bearer $T" "$API/v1/client/payments?limit=1&status=confirmed&after=$C" \
  | jq '{ok, code: .error.code}'   # expect ok:false, CURSOR_INVALID
```

Repeat the third call shape for `/v1/admin/refunds?state=failed` then `state=refunded`, and for
`/v1/admin/fund-receipts?state=pending` then `state=acknowledged`, using the admin cookie pair.

### Follow-ups

- `AdminPageMeta` in `operations/admin-shared.ts` and `PageMeta` in `envelope.ts` are two schemas for
  one wire shape; the admin one types `nextCursor` as a bare `z.string()`, so admin responses do not
  get the scalar's shape check. Ten admin operations reference it. Left alone here to keep this entry's
  blast radius on pagination rather than on a schema rename. See D-044.
- There is still no count endpoint anywhere, so the admin Overview tiles read `25+` rather than a
  queue depth (D-043). If a real depth is wanted, that is a backend addition, not a frontend fix.
- `GET /v1/client/statements`, `GET /v1/client/support/faqs`, `GET /v1/client/research-context` and
  `GET /v1/admin/funds/:id/stocks` remain one-shot on purpose — see D-043 for each reason.


## Entry 024 — Phase 13 backend cleanup, and the four items doc 10 was wrong about

Closes known gap 6 from `README.md`, partially. Decisions: D-046 to D-050. Task: `TASK/020`.

Scope: `backend_controller/` only, plus one file under `.claude/`. The instruction was doc 10's
"Phase 13 — Backend cleanup" list, treated as authority for *what* to look at and not for whether
each item was actually dead. Ten items were audited. **Five were removed or consolidated. Five were
kept**, four of them because the doc's premise was false.

The audit method for every item was the same: grep the whole repository — `src/`, `test/`,
`scripts/`, `db/migrations/`, the guard tests, `package.json` scripts, the compose files, and
`frontend_stack_ts/` — for every identifier and every route literal, before touching anything.

### Removed

**`src/auth/sessionTokens.ts` and its test.** `parseSessionTokenKeys` and
`createSessionTokenService` had exactly one consumer: `sessionTokens.test.ts`. The live web and
native session paths hash refresh and CSRF tokens through `src/auth/refreshDerivation.ts`
(`hashToken`), imported by `domain/auth/webAuth.ts` and `domain/auth/nativeAuth.ts`. The keyed-HMAC
design here was never in force: `CRYPTO_REFRESH_TOKEN_KEY`, `CRYPTO_REFRESH_TOKEN_KEY_VERSION`,
`CRYPTO_CSRF_TOKEN_KEY` and `CRYPTO_CSRF_TOKEN_KEY_VERSION` appear nowhere in the repository outside
this module and its test — not in `.env.example`, not in `.env.production.example`, not in
`runtime/composition.ts`, not in `scripts/generate-deploy-secrets.ts`. Nothing orphaned: the three
`crypto/primitives.ts` helpers it used (`generateOpaqueToken`, `hmacSha256`, `bytesEqual`) all have
other callers.

Both paths were added to `legacy-deletion.guard.test.ts` so the dormant alternative cannot come
back, and the stale `BE-009d` comment in that file — which named `sessionTokens.ts` as the
replacement for `security/tokens.js` — now names `refreshDerivation.ts`.

**`PUT` from the CORS allowed-methods list.** `src/http/cors.ts` advertised
`GET, POST, PATCH, PUT, DELETE, OPTIONS`. No route registers `PUT`: the only method registrations in
`src/routes/**` are `application.{get,post,patch,delete}`, and the only method string literals
anywhere in `src/` are `"GET"`, `"POST"` and `"OPTIONS"`. `cors.test.ts` asserts
`GET, POST, PATCH, DELETE` and never mentions `PUT`. The behaviour change is confined to a preflight
for a method that would have 404'd.

**`user_credentials.locked_until` from `src/db/types.ts`.** No reader and no writer in `src/`,
`test/` or `scripts/`. **The column itself was not dropped** and no migration was written — see
D-048 for why, and for why its two equally-dead neighbours were left in the type.

**The provider-event inbox drain — all three methods, not just `claimReceived`.**
`providerEventInboxRepository.claimReceived`, `.reschedule` and `.deadLetter` each had zero
consumers anywhere. The instruction named only `claimReceived`; removing it alone would have left
`reschedule` (`processing -> received`) and `deadLetter` reachable only from a claim that no longer
existed, which is the dormant-fragment state the forward-only rule exists to prevent. See D-050.
The `provider_events` columns and states that supported the drain were **not** touched.

**`.claude/agent-memory/node-backend-engineer/project_razorpay_test_integration.md`.** Deleted. It
asserted that Razorpay test orders were "the real (not stub) payment integration target" and
instructed any agent to wrap new financial POSTs in `withIdempotency(...)` from
`src/http/idempotency.js` — a module that `legacy-deletion.guard.test.ts` asserts stays deleted, in
a repository whose only payment provider is PhonePe. It was the sole entry in `MEMORY.md`, so
`MEMORY.md` was rewritten to an empty index that names the real mechanism
(`http/idempotencyProtocol.ts::executeIdempotent`). `.claude/` is gitignored, so this is a
working-tree deletion with no commit.

### Consolidated

**Three duplicate `requireIdempotencyKey` bodies.** `routes/clientAutoPaySipRoutes.ts:72`,
`routes/clientOrderRoutes.ts:76` and `routes/adminIdentityRoutes.ts:129` each defined a private copy
of the helper already exported from `routes/adminRouteKit.ts:37`. All four were behaviourally
identical — same header read, same array-first coercion, same `idempotencyKeySchema.safeParse`, same
`VALIDATION_FAILED` with the same `fields` payload; the only differences were line wrapping. The
three locals are gone and all three files now import the shared one. Each also dropped its now-unused
`idempotencyKeySchema` import.

Checked before doing it: `investment-architecture.guard.test.ts:182` asserts the *text*
`requireIdempotencyKey` appears in `adminAumRoutes.ts` and `adminClientGrowthRoutes.ts` — neither is
one of the three, and the identifier survives in the three anyway. The §4.1 dependency-wall test
scans each module's source for forbidden domain words; the added text `"./adminRouteKit.js"` matches
none of `allocation|clientValue|client_value|aum|growth|payment|review`. The `adminRouteKit` name is
now imported by two client route modules, which reads oddly — noted as a follow-up, not renamed here.

### Kept, with the evidence that the doc was wrong

**`optionalIdempotencyKey` is not unused.** Doc 10 lists it as dead. It has three live consumers:
`adminOversightRoutes.ts:148`, `adminContentRoutes.ts:224` and `adminCatalogRoutes.ts:151`. Deleting
it would have broken three admin write paths. Doc 10's row is stale and should be struck.

**`adminFundGrowthPreviewRoutes.ts` is a live endpoint with a live caller.** It is registered at
`runtime/composition.ts:463`, serves `POST /v1/admin/aum/growth/collective/preview`, is exercised by
`test/integration/adminAum.integration.test.ts:189`, and
`frontend_stack_ts/src/features/admin/fund-aum/CollectiveAumGrowthScreen.tsx:52` calls it through
`previewAdminCollectiveAumGrowth`. Removing the module would remove the preview half of the
preview-then-commit protocol from the admin console. See D-049.

**`mandateReconciliationWorker` is wired.** Doc 10 and doc 01 both describe it as having "no
dedicated entrypoint, no compose service, and no health check", which is true and reads as though
it therefore does not run. It does: `runMandateReconciliationPass` is called from
`composePaymentReconciliationWorker`'s `runOnce` at `runtime/composition.ts:698`, inside
the pass that `worker:payments` → `src/paymentReconciliationEntrypoint.ts` executes and records a
`payment_reconciliation` heartbeat for. It is co-hosted, not unwired. See D-047.

**The refund machinery stays whole.** Doc 10's premise — nothing creates a refund row — is correct:
`refundRepository.create` has no production caller, only `test/integration/paymentSettlement`.
Everything else is live. `adminFundReceiptRoutes.ts` serves the refund list (`listPage`), the admin
requeue (`requeue`) and the reconcile-now action; `paymentReconciliationWorker.ts` claims and settles
refunds through `lockDueRefunds`/`markRefunded`/`markFailed`/`markStatusChecked`;
`domain/payments/applyRefundOutcome.ts` applies provider callbacks; and
`frontend_stack_ts/src/features/admin/refunds/RefundQueueScreen.tsx` is a shipped screen reading it
via `useAdminRefunds` behind `refunds.write`. Removing the machinery would delete a working admin
surface to resolve a product question. See D-048; this is still D6 in doc 10's decision log.

### How it was verified — TESTED

In `backend_controller/`:

- `npx tsc -p tsconfig.json --noEmit` — clean. `tsconfig.json`'s `include` covers `scripts/**`,
  `src/**`, `test/**` and both vitest configs, so the integration tests still compile.
- `npx eslint .` — clean, no output. Re-run over the seven touched files with
  `--rule '{"@typescript-eslint/no-unused-vars":"error"}'` explicitly, to prove no import was
  orphaned by a deletion.
- `npx vitest run --config vitest.config.ts` — 75 files, 724 tests, all passing. The config's
  `include` is `src/**/*.test.ts`, so `test/integration/**` is already outside it; no exclude flag
  was needed. Down from 76 files / 726 tests purely by the removal of `sessionTokens.test.ts`.
- `npm run build` (`tsc -p tsconfig.build.json`) — clean.

**Concurrency caveat.** The clean `tsc` and `build` runs above were taken on a tree containing this
entry's changes and the cursor-pagination changes, and *before* the client-cookie-session work
(D-052's `domain/auth/clientWebAuth.ts`, `SessionChannel = "client_web"`, migration
`046_client_web_sessions.sql`) landed in the same working tree. `tsc` on the tree as left reports
errors in `domain/auth/webAuth.ts` and `runtime/composition.ts` only — both mid-edit by that work,
neither touched here. `eslint .` and the 724 unit tests still pass on the tree as left. No file this
entry changed appears in the type-error list.

### Not verified — UNVERIFIED

- **No route was executed.** No PostgreSQL, no HTTP request, no worker pass. The three consolidated
  call sites are argued identical by reading four copies of the same eight lines; nothing has sent an
  `Idempotency-Key` header, or omitted one, through the shared helper on those routes. The check that
  would prove it, on the VPS after deploying:

```
# a client bearer token in $T; expect 400 VALIDATION_FAILED with fields."idempotency-key"
curl -s -X POST "$API/v1/client/orders" -H "authorization: Bearer $T" \
  -H 'content-type: application/json' -d '{"fundId":"<uuid>","amountPaise":"100000"}' \
  | jq '{ok, code: .error.code, fields: .error.fields}'
# then the same call with a key, twice, and confirm one order — not two
K=$(uuidgen)
for i in 1 2; do curl -s -X POST "$API/v1/client/orders" -H "authorization: Bearer $T" \
  -H "idempotency-key: $K" -H 'content-type: application/json' \
  -d '{"fundId":"<uuid>","amountPaise":"100000"}' | jq -r '.data.id'; done
# repeat the missing-key shape for POST /v1/client/sip-autopay and
# POST /v1/admin/applications/:id/decision (admin cookie pair + x-csrf-token)
```

- **The CORS preflight.** `cors.test.ts` passes, but the header a browser actually receives has not
  been observed. `curl -i -X OPTIONS "$API/v1/health" -H "origin: https://localhost" -H
  "access-control-request-method: POST"` should show `access-control-allow-methods` without `PUT`.
- **That nothing reads `user_credentials.locked_until` at runtime.** The evidence is a grep over
  authored source. A raw `select *` would still return the column; the Kysely type no longer
  declares it, which is a compile-time narrowing only.

### Follow-up — a real risk this created

**Branch coverage is now one branch above the gate.** `vitest.config.ts` sets an 80% threshold on
all four metrics. Before this entry: branches 1142/1424 = **80.19%**. After: 1131/1413 = **80.04%**.
`sessionTokens.ts` was fully covered by the test that was its only consumer, so deleting the pair
removed 11 covered branches out of 11 and dragged the average down. `npm run check` passes, but one
new uncovered branch anywhere in `src/` — outside the `repositories/`, `routes/` and `domain/`
coverage excludes — now fails it. This was measured, not inferred: the deleted files were restored
from `HEAD`, coverage re-run, and removed again.

The fix is not to restore dead code. It is that `runtime/composition.ts` (72.16% lines, the largest
single deficit) and `providers/phonepe/gatewayFailure.ts` (69.35%) have no unit tests worth the name,
and the threshold has been riding on a well-tested dead module. Whoever next touches either should
expect to add coverage before the gate lets them through.

### Other follow-ups

- `db/repositories.ts:58` `export type ProviderEvent = Row<"provider_events">` now has no importer.
  Left in place: that block is a systematic one-alias-per-table index of 44 aliases, and
  removing one entry because its repository stopped needing it would make the index lie about the
  schema rather than about the code.
- Doc 10's Phase 13 tables need three corrections applied at the source: `optionalIdempotencyKey` is
  not unused, `adminFundGrowthPreviewRoutes.ts` is not removable, and `mandateReconciliationWorker`
  is wired. They were not edited here — this log is the correction of record, per the README's rule
  that the log wins where it and a numbered document disagree.
- `backend_controller/.env.legacy-backup`, which doc 10 lists for deletion or key rotation, **does
  not exist** in the working tree. The only env files present are `.env`, `.env.example`,
  `.env.local-e2e` and `.env.production.example`. Nothing to do; if those Razorpay keys were ever
  real they are still worth rotating, which is not a code change.
- Untouched from doc 10's list, and still open: the `CACHE_KEYS.fundList` / `CACHE_PREFIXES` question
  (BC10 wants `invalidatePrefix` wired, not deleted), the `POST /v1/client/email-verification/resend`
  alias, the `payments.mobileSdk` rename, `MOBILE_CHECKOUT_DISABLED`, the
  `email_verification_state = 'rejected'` CHECK value, the fixture-name residue, in-process rate
  limiting, `legacy_investment_reviews`, and the suspend/reinstate/close surface. None was in this
  entry's instruction.


## Entry 025 — the browser client stopped holding refresh tokens, by getting a cookie session first

D-037 was reverted on the day it landed because it removed `localStorage` persistence without
providing anything to replace it, and a browser SPA loses memory on **every** full document load.
This entry builds the replacement, then removes the persistence. In that order, for that reason.

Decisions: **D-052**. D-037 carries a second correction. Task file: `TASK/021-client-scope-cookie-session.md`.

### What landed

**Backend — a third session channel.**

- `db/migrations/046_client_web_sessions.sql`: `session_channel` gains `client_web`, and
  `auth_sessions_web_csrf_present` is restated as "every non-native channel carries a CSRF pair" so it
  covers the new label without naming it (`ALTER TYPE ... ADD VALUE` cannot use the value in the same
  transaction, and the runner wraps each file in one). `SessionChannel` in `db/types.ts` follows.
  **Ordering: this migration must be applied before the backend image that writes `client_web`.**
- `domain/auth/webAuth.ts` is now generic over a `WebAuthScope`. `webLogin`, `webRefresh`,
  `webRecoverCsrf` and the new `authenticateCookieSession` are one implementation each; the scope
  supplies cookie names, session channel, audit command, audit actor type, principal builder and
  login-eligibility rule. `ADMIN_WEB_SCOPE` preserves admin behaviour exactly, including the
  `roles.length === 0 → not_authorized` rejection. `validateWebOrigin` now takes the allowlist rather
  than a deps object, so routes whose `config` is already occupied can call it.
- `domain/auth/clientWebAuth.ts`: `CLIENT_WEB_SCOPE` (channel `client_web`, cookies
  `boe_client_access`/`boe_client_refresh`, audit `auth.client_web_login`, actor `user`, no
  eligibility rule beyond an active account with a correct password — the same bar `nativeLogin`
  sets), plus `resolveClientPrincipal`, the dual-transport resolver.
- `routes/clientWebAuthRoutes.ts`: `POST /v1/auth/client/web/login`, `POST .../refresh`,
  `GET .../csrf`, `POST .../logout`.
- All 30 principal resolutions across the seven `client*Routes.ts` files moved from
  `authenticateNativeRequest` to `resolveClientPrincipal`. Their deps interfaces extend
  `ClientRequestAuthDeps`, which adds one field, `clientWeb: { originAllowlist }`.
- `authSessionRepository.createWebSession` takes the channel; `rotateWebCsrf` takes it too and carries
  it in the `WHERE`, so one audience's reload recovery cannot rotate the other's token.

**Contracts — 94 → 98 operations, 84 → 88 paths.**

- `operations/client-web-auth.ts` with the four operations and a `client-web` /
  `client-session-cookie-and-csrf` variant in the `OperationSecurityPolicy` union.
- `admin-oversight.ts`'s `AdminLoginEvent.channel` gains `client_web`, because client browser sign-ins
  are recorded in `auth_login_events` with that channel and the admin sign-in history validates every
  response against this contract. Without it the first client web login would have made the admin
  screen fail with a malformed-response error.
- Regenerated `generated/openapi-v1.{json,d.ts}` and `frontend_stack_ts/src/api/generated/operations.ts`.
  `check:frontend-contract-bypass` reports 98 contracted, 98 generated.

**Frontend — the transport is chosen by the shell.**

- `createClientRuntime` now has a native half (unchanged: bearer pair, Secure Storage) and a browser
  half (cookie login, cookie logout, cookie refresh, and a `restore()` that re-establishes the session
  from `GET /v1/auth/client/web/csrf` rather than from anything the page remembered).
- `persistSecrets: isNative()`, and `purgeLegacyLocalSecrets()` runs on both platforms. This is the
  reverted change, reapplied — and this time it costs nothing.
- `adminRuntime.executeRefresh` was repaired in passing: it called `webRefresh` with
  `unauthenticated: true`, the flag that suppresses the automatic `x-csrf-token` header, so **every
  admin refresh was answered CSRF_INVALID**. It now recovers the token first and passes it explicitly.
- `clientRuntime.test.ts`: the test that pinned the `localStorage` behaviour is gone. In its place:
  no secret reaches `localStorage` in a browser, none on a native shell either, pre-existing leaked
  secrets are purged on construction, a second runtime recovers no secret across a document load,
  `restore()` calls `/v1/auth/client/web/csrf` and returns the principal from the reply while
  `localStorage` stays empty, and — the guard on the transport switch itself — a browser login goes to
  `/v1/auth/client/web/login` and holds no token afterwards while a native login goes to
  `/v1/auth/native/login` and holds the pair in memory. Nine tests, `fetch` stubbed for four of them.

### Why the smoke suite should return to 71/71

This cannot be run here. The argument is per-navigation, because the reverted attempt failed
specifically at `page.goto`.

The mechanism: Playwright cookies live in the **BrowserContext**, not the page. `page.goto`,
`page.reload` and `context.newPage()` all discard the document and its JavaScript heap; none of them
touches the cookie jar. `SessionProvider` holds `status: "restoring"` until `restore()` settles, and
every gated route waits on that, so each new document re-establishes the session before a screen
renders. `restore()` needs only the cookies the browser sends automatically. That is the whole
difference from the reverted change, where `restore()` needed an access or refresh token from memory
and the document had just lost both.

Walking the client suite in order:

| Navigation | Why the session survives |
| --- | --- |
| `goto(CLIENT_URL)` | Anonymous. `restore()` → `GET .../csrf` → 401 → `anonymous` → redirect to `/login`. Nothing to survive; the 401 is a completed response, not a `requestfailed`, so the "no failed API requests" check is unaffected — which is already proven by the admin suite, whose login page 401s the same way today and passes. |
| `signIn(...)` | `POST /v1/auth/client/web/login` sets both cookies; the SPA routes to `/dashboard` client-side, no document load. |
| `getByRole("link", { name: "Portfolio" }).click()` | Client-side route change. Memory intact. |
| `goto(/profile/security)` | First hard navigation after login. New document, empty memory, both cookies sent. `restore()` → 200 → `authenticated`. |
| `goto(/statements)`, `(/notifications)`, `(/profile/support)`, `(/profile/legal)`, `(/profile/legal/grievance)`, `(/activity?tab=payments)`, `(/sips)`, `(/dashboard)`, `(/funds)`, `(/portfolio)`, `(/activity)`, `(/funds/<unknown-uuid>)`, `(/verify-email)` | Identical to the row above, thirteen more times. The access cookie is `Max-Age=600`; the whole client section runs in seconds. |
| `goto(/this-route-does-not-exist)` | Same restore, then the not-found screen. It does not need a session, but it gets one. |
| `POST` send-code and verify-code on `/verify-email` | Both carry `x-csrf-token` from the token this document's own `restore()` obtained, and the backend compares it against the same session row. Unsafe methods are exactly what `resolveClientPrincipal` demands CSRF for. |
| `page.reload()` after verification | Document load, cookies unchanged, restore, gate re-read from the server. |
| `context.newPage()` → `goto(/dashboard)` | A new page in the **same context**: the cookie jar is shared, so this is the previous case with a new tab. This is the check that failed under the reverted change, and the check whose name said "secure storage fallback" — renamed here to name the cookie session. |
| `runClientSeesFund`: `newContext()` → `goto(/login)` | A **fresh** context, so no cookies: anonymous, sign in again, exactly as the suite intends. |
| `goto(/funds)`, `goto(/funds/<id>)` ×2 | Same-context document loads after that sign-in. Restore each time. |

Two further conditions, both satisfied:

- **Origin.** Cookie authentication runs `validateWebOrigin`. POSTs carry `Origin: http://localhost:5174`,
  which the committed `.env.example` allow-lists and `originExamples.test.ts` enforces. Same-origin GETs
  carry no `Origin` and fall back to `Referer`, which Chromium sends in full for same-origin requests.
  The admin console has depended on that fallback for every cookie-authenticated read since it shipped.
- **The ten-minute access cookie.** If the run ever outlasted it, the next request would 401
  AUTHENTICATION_REQUIRED, `executeCookieRefresh` would recover the CSRF token from the refresh cookie
  and rotate, and the request would be retried. The transport reaches that path only on
  AUTHENTICATION_REQUIRED, which is precisely why `resolveClientPrincipal` falls through to the bearer
  path when there is no client cookie rather than into the Origin check.

The admin half of the suite is untouched. The only admin change is inside `executeRefresh`, which the
suite never reaches, so it cannot regress a passing check — it can only turn a guaranteed failure into
a probable success.

### Verification

**TESTED here:**

- `frontend_stack_ts`: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run` (18 files, 179 tests),
  `VITE_BEO_APP_TARGET=client npx vite build`.
- `packages/contracts`: `npm run typecheck`, `npm run lint`, `npm test` (95 tests), `npm run build`,
  `npm run generate`, `npm run check:frontend-contract-bypass` → 98 contracted, 98 generated.
- `backend_controller`: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run --exclude
  'test/integration/**'` (75 files, 724 tests).

**STATIC only:** every claim about the two scopes not being able to authenticate each other. It is a
reading of four independent predicates (cookie name, session channel, rotation channel filter, CSRF
per row), not an executed attack. The cheap runtime proof is in the UNVERIFIED list below.

**UNVERIFIED — needs the migration applied and the stack running. Nothing here has touched a database.**

Migration first, then the backend image:

```
# on the VPS, in release_manager/, as part of the normal release
node --env-file-if-exists=.env --import=tsx src/scripts/migrate.ts status | tail -3
# expect: pending 046_client_web_sessions.sql   → then the release applies it
psql -c "select unnest(enum_range(null::session_channel))"     # native, web, client_web
```

Then, against the deployed API (`$API`, `$ORIGIN` = the client SPA origin):

```
# 1. a browser client session, end to end
curl -s -c jar -X POST "$API/v1/auth/client/web/login" -H "origin: $ORIGIN" \
  -H 'content-type: application/json' -d '{"email":"...","password":"..."}' \
  | jq '{ok, user: .data.user.userId, csrf: (.data.csrfToken != null)}'
grep -c boe_client_ jar                     # expect 2 cookies, neither named boe_access
curl -s -b jar "$API/v1/client/eligibility" -H "referer: $ORIGIN/dashboard" | jq '.ok'

# 2. reload recovery: the CSRF endpoint on cookies alone
curl -s -b jar "$API/v1/auth/client/web/csrf" -H "referer: $ORIGIN/dashboard" | jq '.data.csrfToken != null'

# 3. rotation, with the token from step 2 as $C
curl -s -b jar -c jar -X POST "$API/v1/auth/client/web/refresh" -H "origin: $ORIGIN" \
  -H "x-csrf-token: $C" -H 'content-type: application/json' -d "{\"rotationId\":\"$(uuidgen)\"}" | jq '.ok'

# 4. SCOPE ISOLATION — the claim that is only STATIC above.
#    Take the admin access cookie value from an admin login and present it under the client name:
curl -s "$API/v1/client/eligibility" -H "referer: $ORIGIN/dashboard" \
  -H "cookie: boe_client_access=$ADMIN_ACCESS" | jq '.error.code'      # expect SESSION_INVALID
#    And the reverse: a client access cookie presented under the admin name:
curl -s "$API/v1/admin/session" -H "referer: $ADMIN_ORIGIN/overview" \
  -H "cookie: boe_access=$CLIENT_ACCESS" | jq '.error.code'            # expect SESSION_INVALID
#    And either one as a bearer token:
curl -s "$API/v1/client/eligibility" -H "authorization: Bearer $CLIENT_ACCESS" | jq '.error.code'
                                                                        # expect SESSION_INVALID

# 5. CSRF is required on writes and not on reads
curl -s -b jar -X POST "$API/v1/client/support-requests" -H "origin: $ORIGIN" \
  -H 'content-type: application/json' -d '{"subject":"x","message":"y"}' | jq '.error.code'
                                                                        # expect CSRF_INVALID

# 6. the admin refresh repair, which no test covers
#    log in to the console, wait out the 10-minute access cookie, then load a screen:
#    it must rotate and stay signed in rather than bouncing to /login.
```

- **The APK is unverified.** `isNative()` selects the bearer path and the native operations did not
  change, but the client routes it calls now resolve their principal through a different function.
  Needs an install and a sign-in.
- **The smoke suite itself.** The reasoning above is reasoning. `71/71` is the acceptance and it has
  not been observed.
- **Multi-tab behaviour.** The refresh path was made safe by construction (recover, then rotate); a
  concurrent *write* from a second tab still fails CSRF_INVALID once. Not exercised.

### Notes for whoever reads this next

- Regenerating `packages/contracts/generated/**` also picked up the uncommitted cursor-pagination
  work that was in the tree at the time (the `Cursor` scalar's new pattern and the paginated
  envelopes). There is one generated artifact and one source tree; it could not be split. The
  operation count moved by exactly the four operations added here.
- The four integration-test harnesses that build client route deps by hand now pass
  `clientWeb: { originAllowlist: [] }`. Empty is deliberate — those harnesses authenticate with bearer
  tokens and never take the cookie path, and an empty allowlist fails closed if one ever does.
- `test_e2e/frontend-ts-smoke.mjs` has two renamed checks and no new or removed ones: "native login
  lands on the dashboard" is a cookie login now, and "survives a fresh page load from secure storage
  fallback" survives on cookies. The count is unchanged at 71.



## Entry 026 — A bearer channel for the admin scope, so the shipped admin APK can sign in · 2026-08-31

Decision: **D-053**. Task file: `TASK/022-admin-native-bearer-channel.md`. Mirrors Entry 025 in
shape and in method: generalise the existing machinery over a scope descriptor rather than copy it.

### The problem

`package.json` ships `build:android:admin`, `android:sync:admin` and `android:apk:admin`,
`capacitor.config.ts` has an admin variant, `frontend_stack_ts/resources/launcher/admin/` holds real
branding, `emu/boe_update.sh --both` builds it, and `release_manager/tests/hermetic_branding.test.sh`
makes 17 admin assertions. The target is deliberate. It could not log in.

Two reasons, one on each side:

- **Frontend.** `adminRuntime` was cookie-only, and an APK is served from `https://localhost`, which
  is cross-site with the API host. `SameSite=Lax` withholds the cookie on a cross-site subresource
  request and `validateWebOrigin` refuses `Sec-Fetch-Site: cross-site` outright, so the cookie login
  cannot succeed there at all. `buildAdminDevice` — named in doc 03, doc 10 and the README — did not
  exist.
- **Backend.** There was no admin bearer login. `resolveAdminPrincipal` already had a bearer leg, but
  it called `authenticateNativeRequest`, which admits any active session whose channel is `native` —
  the *investor* APK's channel. So the only obtainable bearer token for an admin request was a client
  token, and an investor's token satisfied admin **authentication**, leaving the permission check as
  the sole thing between an investor and the console. That is the exact error D-052 named: two
  audiences separated at the authorization layer rather than the authentication layer, when
  permissions are per-user and one person can hold both accounts.

### What was built

**Migration `047_admin_native_sessions.sql`** — a fourth session channel, `admin_native`. Built
exactly like 046, including the constraint that made 046 possible: `ALTER TYPE ... ADD VALUE` may run
inside a transaction on PostgreSQL 12+, but the new label cannot be *used* until that transaction
commits, and the runner wraps each file in one — so nothing in the file names `admin_native`.

Where 046 could restate the CSRF rule as "every non-native channel carries a CSRF pair", 047 cannot:
`admin_native` is a bearer transport with no synchronizer token, so that phrasing would have demanded
a CSRF pair on a row that must not have one. Both halves are restated against the two *cookie*
labels instead — `auth_sessions_web_csrf_present` requires the pair when
`channel IN ('web','client_web')`, `auth_sessions_native_csrf_null` forbids all CSRF material
otherwise. The pair stays exhaustive and stays exhaustive as further bearer channels are added.

`auth_sessions_active_native_device_uk` was scoped to `channel = 'native'`, so an admin bearer session
would have had no same-device backstop at all. It is replaced by
`auth_sessions_active_bearer_device_uk` on `(user_id, channel, device_id_hash)` where the channel is
not a cookie channel. `channel` is in the *key*, not only the predicate, so one person holding both
APKs on one handset cannot collide across audiences.

**`domain/auth/nativeAuth.ts` is now generic over a `NativeAuthScope`**, the way `webAuth.ts` is
generic over a `WebAuthScope`. One `nativeLogin`, one `nativeRefresh`, one
`authenticateBearerSession`; the scope supplies the session channel, the audit command, the audit
actor type, the principal builder and the login-eligibility rule. `CLIENT_NATIVE_SCOPE` lives beside
them, `ADMIN_NATIVE_SCOPE` in `domain/auth/adminNativeAuth.ts`. The reason is the same as last time:
the 30-second previous-token grace, the same-`rotationId` reproduction and the family revocation on
reuse are the subtle parts and the parts a copy would drift on.

**Three endpoints**, contracted and generated (98 → **101** operations, 88 → **91** paths):

```
POST /v1/auth/admin/native/login     AdminNativeSessionData (WebPrincipal + bearer pair)
POST /v1/auth/admin/native/refresh   rotation on the admin chain only
POST /v1/auth/admin/native/logout    revokes the family
```

`AdminNativeSessionData` carries the operator's roles and resolved permissions — the same
`WebPrincipal` the cookie login returns, so the console renders identically on both hosts. The client
native login was **not** widened to return permissions. Handing an investor app a permission list
would make the two audiences' tokens interchangeable in exactly what they authorise, which is the one
place it matters; the audiences stay separate the way the two cookie scopes do.

There is no CSRF token and no Origin check on these three, and nothing is weakened by that: the
credential is a bearer token, which a hostile page cannot make a browser attach and cannot read from
another origin's storage. Those checks protect ambient credentials and there is no ambient credential
on this path. The cookie path keeps every one of them.

**`resolveAdminPrincipal` keeps its shape** — cookie preferred when present, bearer only when there is
no access cookie *and* a `Bearer` header — and its bearer leg now calls
`authenticateAdminNativeRequest`. Every admin route was already on the resolver (11 route files), so
no route changed. Permission checks are untouched: `requireAnyPermission` on the server and
`RequirePermission` in the console both read the same live permission set, which
`resolveAdminPrincipal` still loads from the database on every request.

**Frontend.** `adminRuntime` now branches on `isNative()` exactly as `clientRuntime` does: Secure
Storage plus `persistSecrets: isNative()`, `executeNativeRefresh` against the admin rotation endpoint,
`nativeSignIn`/`nativeSignOut`, and a `nativeRestore` that re-establishes from the stored pair and
then reads `getAdminSession` live so a revoked role takes effect on the next start. The browser path
is byte-for-byte the previous behaviour, including the recover-then-rotate refresh fix from Entry 025.

`buildAdminDevice` lives in the new `src/platform/nativeDevice.ts` alongside `buildClientDevice`, one
builder taking the scope. `clientRuntime`'s three inlined copies of the descriptor and the
compatibility headers were replaced by calls to it — the descriptor shape is load-bearing (the backend
hashes `installationId` into `device_id_hash` for same-device replacement) and two hand-maintained
copies of a load-bearing shape is how they drift. The installation id is per scope
(`boe.admin.installationId` vs `boe.client.installationId`), so the two APKs enrol as different
devices and their per-channel caps stay independent.

### The scope-isolation argument

D-052's four predicates, restated for four scopes and asserted in
`src/domain/auth/scopeIsolation.test.ts` (20 tests):

1. **Distinct credential name or location.** The two cookie scopes use disjoint cookie names
   (asserted). The two bearer scopes both present `Authorization: Bearer`, so for them the
   discriminator is the session channel plus the distinct endpoint — see 2. There is deliberately no
   scope claim in the access token: D-052 rejected that, because a discriminator the existing channel
   predicate does not look at means every authentication path has to learn a second check, and the one
   that forgets is the vulnerability.
2. **The channel is compared exactly, on all four paths.** `authenticateBearerSession` takes the
   channel from its *caller*, not from the token, and the two helpers
   (`authenticateNativeRequest`, `authenticateAdminNativeRequest`) are one-line partial applications,
   so a route cannot accidentally accept "whatever channel this token belongs to". The full 4×4 matrix
   is asserted: each of the four channels is presented to each of the four authenticators and only the
   diagonal resolves.
3. **Rotation is channel-scoped.** `nativeRefresh` now refuses a refresh token whose session channel
   is not the scope's — it did not check at all before. Asserted, including that the refusal happens
   *before any write*, so a mismatched channel is not mistaken for refresh reuse and does not revoke
   the innocent session's family. `webRefresh` and `rotateWebCsrf` already carried the channel.
4. **No shared session row.** A login writes its own channel and nothing rewrites it; the unique
   index has `channel` in the key. Additionally `ADMIN_NATIVE_SCOPE.rejectLogin` refuses an account
   with no roles, so an investor cannot obtain an `admin_native` session in the first place — the
   audiences are separated at issuance as well as at use.

An admin bearer therefore does not work as a client bearer, a client bearer does not work as an admin
bearer, and neither cookie works as either bearer.

### Migration ordering

**`047_admin_native_sessions.sql` must be applied before the code that writes `admin_native` runs.**
A release whose backend serves `/v1/auth/admin/native/login` against a database still at 046 will fail
the login with an invalid-enum-value error on the session insert. The migration is additive and
touches no data; it drops and recreates two CHECK constraints and one partial unique index on
`auth_sessions`.

### Verified

- **TESTED** `backend_controller`: `npx tsc --noEmit`, `npx eslint .`,
  `npx vitest run --exclude 'test/integration/**'` → **76 files, 744 tests, all passing** (was 738:
  +20 `scopeIsolation.test.ts`, −14/+14 in the rewritten `adminAccess.test.ts` mock target, +1
  assertion in `composition.test.ts`).
- **TESTED** `packages/contracts`: `npm run typecheck`, `npm run lint`, `npm run test` (95),
  `npm run build`, `npm run test:exports`, `npm run lint:openapi`,
  `npm run check:frontend-contract-bypass` → *"No contract bypasses. 101 contracted operations, all
  reachable through the generated client."*
- **TESTED** `frontend_stack_ts`: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run` → **19 files,
  186 tests** (was 179: +7 `adminRuntime.test.ts`), `VITE_BEO_APP_TARGET=admin npx vite build` → built
  in 1.48s.
- **STATIC** The integration suite was kept compiling but not run (testcontainers). Two
  `createBearerSession` call sites in `authRepositories.integration.test.ts` now pass
  `channel: "native"`; nothing else in `test/integration/**` needed a change.

### UNVERIFIED — what a green suite here does not establish

Nothing below has been observed. The unit tests exercise the channel predicate against a stubbed
database; they do not exercise PostgreSQL, the migration, or an APK.

**The migration.** Not applied anywhere. On the VPS, before the code:

```
cd /path/to/backend_controller && npm run migrate        # expect 047 applied
psql "$DATABASE_URL" -c "select unnest(enum_range(null::session_channel));"
#   expect native, web, client_web, admin_native
psql "$DATABASE_URL" -c "\d auth_sessions" | grep -E 'csrf_present|csrf_null|bearer_device'
#   expect both CHECKs restated against ('web','client_web') and auth_sessions_active_bearer_device_uk
```

**The endpoints.** Against the deployed API (`$API`), with an operator account and a plain investor
account:

```
# 1. an admin bearer session, end to end
curl -s -X POST "$API/v1/auth/admin/native/login" -H 'content-type: application/json' \
  -H 'x-client-platform: android' -H "x-app-version: 0.1.0" \
  -d "{\"email\":\"$OPS_EMAIL\",\"password\":\"$OPS_PW\",\"device\":{\"installationId\":\"$(uuidgen)\",\"name\":\"curl\",\"platform\":\"android\",\"appVersion\":\"0.1.0\"}}" \
  | jq '{ok, roles: .data.user.roles, permissions: (.data.user.permissions | length), sid: .data.sessionId}'
# expect ok:true and a non-empty permission list — an empty one means the console renders nothing

export ADMIN_BEARER=...   # .data.accessToken from above
curl -s "$API/v1/admin/session" -H "authorization: Bearer $ADMIN_BEARER" | jq '.ok'

# 2. an investor cannot obtain an admin session at all
curl -s -X POST "$API/v1/auth/admin/native/login" -H 'content-type: application/json' \
  -H 'x-client-platform: android' -H 'x-app-version: 0.1.0' \
  -d "{\"email\":\"$CLIENT_EMAIL\",\"password\":\"$CLIENT_PW\",\"device\":{\"installationId\":\"$(uuidgen)\",\"name\":\"curl\",\"platform\":\"android\",\"appVersion\":\"0.1.0\"}}" \
  | jq '.error.code'                                        # expect INVALID_CREDENTIALS
psql "$DATABASE_URL" -c "select channel, outcome from auth_login_events order by occurred_at desc limit 1;"
#   expect admin_native / not_authorized

# 3. CROSS-SCOPE REPLAY — the claim that is only TESTED-against-a-stub above.
export CLIENT_BEARER=...  # from POST /v1/auth/native/login as the investor
curl -s "$API/v1/admin/session"      -H "authorization: Bearer $CLIENT_BEARER" | jq '.error.code'
#   expect SESSION_INVALID — NOT AUTHORIZATION_DENIED. Denied means the channel check did not fire
#   and the permission check caught it, which is the pre-existing defect, not the fix.
curl -s "$API/v1/client/eligibility" -H "authorization: Bearer $ADMIN_BEARER" | jq '.error.code'
#   expect SESSION_INVALID
curl -s -X POST "$API/v1/auth/native/refresh" -H 'content-type: application/json' \
  -d "{\"refreshToken\":\"$ADMIN_REFRESH\",\"rotationId\":\"$(uuidgen)\"}" | jq '.error.code'
#   expect SESSION_INVALID, and the admin session must still be active afterwards:
psql "$DATABASE_URL" -c "select state from auth_sessions where id = '$ADMIN_SID';"   # expect active
curl -s -X POST "$API/v1/auth/admin/native/refresh" -H 'content-type: application/json' \
  -d "{\"refreshToken\":\"$CLIENT_REFRESH\",\"rotationId\":\"$(uuidgen)\"}" | jq '.error.code'
#   expect SESSION_INVALID, client session still active

# 4. the admin cookie path is unchanged
#    log in to the browser console, load a screen, wait out the 10-minute access cookie,
#    load another: it must rotate and stay signed in.
```

**The APK.** Never built, installed or launched for this change:

```
cd frontend_stack_ts && npm run android:apk:admin
adb install -r android/app/build/outputs/apk/debug/app-admin-debug.apk
# then: sign in as an operator, confirm the overview renders, confirm a permission-gated
# screen is reachable, background the app for >10 minutes and confirm it rotates rather
# than signing out, then sign out and confirm the session row is revoked.
```

The three things that would not be caught by anything above and have to be looked for on device:
Secure Storage actually persisting the pair across process death (kill the app from the task
switcher, not just background it); `getAdminSession` being reachable with a bearer token rather than
404ing behind a cookie assumption; and the login screen's `AuthPort` wiring, since `AdminShellRoot`
passes `runtime.login` through unchanged and a shell that never re-reads the runtime would keep the
cookie path.

**Same-device replacement and the device cap on the admin channel.** Both are now channel-scoped and
neither has been exercised. Sign in twice from the same admin installation and confirm one active
`admin_native` row; sign in from three installations with `DEVICE_LIMIT_MAX_DEVICES=2` and confirm the
oldest admin session is evicted and the same operator's *client* session is untouched.

### Notes for whoever reads this next

- Renamed, and worth knowing before reading a diff: `createNativeSession` →
  `createBearerSession`, `lockActiveNativeByUserAndDevice` → `lockActiveBearerByUserAndDevice`,
  `listActiveNativeForUserOldestFirst` → `listActiveBearerForUserOldestFirst`. All three now take the
  channel. `SessionChannel` gained `CookieSessionChannel` and `BearerSessionChannel` derivations, and
  `webAuth.ts`'s `WebSessionChannel` was `Exclude<SessionChannel, "native">` — which would silently
  have admitted `admin_native` as a cookie channel — and is now `CookieSessionChannel`.
- The contracted `authChannel` labels on admin operations remain `admin-web` even though those routes
  accept a bearer token. That is already true on the client side after Entry 025 (client operations are
  labelled `native-bearer` while `resolveClientPrincipal` accepts the cookie). The labels name the
  originating transport, not the accepted set; making them exhaustive is a contract-wide change and is
  not attempted here.
- `AdminLoginEvent.channel` in `admin-oversight.ts` gained `admin_native`. Without it the first admin
  APK sign-in in a user's history would have failed the response contract validation in the console,
  which is a malformed-response error rather than a missing row — easy to misdiagnose.


## Entry 027 — payments on the dev stack are blocked by PhonePe, not by us · 2026-08-29

Diagnosis first, then the one code change it justified. The narrative is in
`TASK/023-phonepe-payment-diagnosis.md`; this entry is what changed and what is proven.

### The finding

Payments from `https://dev-app.beonedge.in` cannot succeed. PhonePe's own checkout page gets
HTTP 400 with `errorCode: INTERNAL_SECURITY_BLOCK_1` and a body naming
`Onboarding_URL: ["www.beonedge.in"]` against `Transacting_URL: "https://dev-app.beonedge.in/"`.
The merchant is whitelisted for a different domain. `isRetryEnabled: false`. No change to this
repository can fix it — it needs a PhonePe dashboard change or serving the client from the
onboarded domain.

Our chain up to the redirect is correct and was observed working: order `201`, pay `200`, redirect
to `https://mercury-t2.phonepe.com/transact/pgv3?token=…`, PhonePe rendering "Beonedge LLP" with
the right amount. **VPS** — observed read-only against the deployed stack in a headed browser.

The maintainer's hypothesis (that `mercury-t2` was not an allowed origin) is **disproven**:
`mercury-t2.phonepe.com` is the correct production host for Standard Checkout v2 and was already in
both the compiled frontend allowlist and the deployed `PHONEPE_CHECKOUT_ALLOWED_ORIGINS`.

### What changed

**`mercury-uat.phonepe.com` added to the checkout allowlists that may run against sandbox.**
Not a fix for the block above — a latent trap found while ruling that block out. Standard Checkout
v2 returns `mercury-uat.phonepe.com` when `PHONEPE_ENV=sandbox`, and no allowlist listed it. So the
obvious next diagnostic step — flip to sandbox to take the production merchant out of the picture —
would itself have failed every payment, at `trustedCheckoutUrl()`, with the *same* generic error
screen. Two unrelated causes, one indistinguishable symptom.

- `frontend_stack_ts/src/features/payments/checkout.ts` — `CHECKOUT_ORIGIN_ALLOWLIST`. One list for
  all builds; it already carried `api-preprod.phonepe.com`, so the sandbox host is consistent there.
- `backend_controller/.env.example` and `release_manager/stacks/dev_release/.env.example` — the two
  examples whose `PHONEPE_ENV` may legitimately be flipped to `sandbox`.

Deliberately **not** added to `backend_controller/.env.production.example` or
`release_manager/stacks/prod_release/.env.example`. A production stack has no business trusting a
UAT redirect, and `PHONEPE_ENV` there is never `sandbox`.

`release_manager/stacks/*/.env.example` had drifted from the `backend_controller` examples and held
their own copies of this key. That drift is the reason for the guard below.

**A drift guard, in `backend_controller/src/http/originExamples.test.ts`.** Same defect class the
file already guards for `WEB_ORIGIN_ALLOWLIST`, and now the same treatment for
`PHONEPE_CHECKOUT_ALLOWED_ORIGINS`: every example lists the production host, every entry is an exact
https origin with no wildcard and no path, the two sandbox-capable examples list the UAT host, and
the two production examples do not. 12 tests.

### Verification

- **TESTED** `cd frontend_stack_ts && npx tsc -p tsconfig.json --noEmit` — clean.
- **TESTED** `npx eslint .` in both `frontend_stack_ts` and `backend_controller` — clean.
- **TESTED** `cd frontend_stack_ts && npx vitest run` — 19 files, 186 tests, all passed.
  `features/payments/checkout.test.ts` (12 tests) still passes; it builds its own local allowlist
  rather than importing `CHECKOUT_ORIGIN_ALLOWLIST`, so it does not pin the contents.
- **TESTED** `cd backend_controller && npx vitest run --coverage` — 76 files, **756** tests (744
  before), all passed. Branch coverage 80.08%, gate 80%, unchanged by this entry.
- **TESTED** the new guard is not vacuous: reverting `dev_release/.env.example` to its previous
  value made it fail 1 of 23, and only that one. Restored afterwards.
- **TESTED** `./release_manager/verify.sh` — 108 passed, 0 failed, 1 skipped (remote). This is the
  gate that reads the stack `.env.example` files for Compose-variable parity.
- **VPS** the 400 body, the redirect host, the `.env` values and the order/payment rows were all
  read from the deployed stack read-only. Nothing was deployed or restarted.

### Not verified

- **UNVERIFIED** that a payment completes. It cannot be, from this domain. Once PhonePe whitelists
  `dev-app.beonedge.in`, the chain to re-check is order → payment → **allocation** → acknowledgement,
  because the allocation and acknowledgement legs have never run against a real settled payment.
  `investment_allocations` gaining a row is the signal.
- **UNVERIFIED** the sandbox path end to end. The allowlist entry is a static string match; that
  `mercury-uat.phonepe.com` is what a sandbox merchant returns is from PhonePe's create-payment
  documentation, not from a request made here. Exercising it needs sandbox credentials, which the
  deployed stack does not have.
- The deployed `.env` was **not** modified. If `PHONEPE_ENV` is ever set to `sandbox` on the VPS,
  `PHONEPE_CHECKOUT_ALLOWED_ORIGINS` in `/srv/dev_stack/BOE_APP/dev_release/.env` needs
  `https://mercury-uat.phonepe.com` appended by hand — the example files are not the deployed file.


## Entry 028 — correcting Entry 027: payments did work, under sandbox credentials · 2026-08-29

Entry 027 stands on its finding — `INTERNAL_SECURITY_BLOCK_1`, merchant onboarded for
`www.beonedge.in`, transaction from `dev-app.beonedge.in` — and is **wrong in its framing**. It
presented the block as a standing condition and listed "a payment has never completed" as merely
unverified. The maintainer said payments used to pass through around v0.10.7, from this same host.
They were right. Full timeline in `TASK/024-payment-regression-timeline.md`.

### The correction

Entry 027 only looked at the live database. That database was **created 2026-08-27 09:53** and holds
no history before it, which is why it showed zero successful payments — absence of records, not
absence of payments. `paths.json` on the VPS points at the real backup locations, and the pre-deploy
dump for 0.11.6 contains:

```
payments: 24 rows, 7 succeeded          investment_allocations: 7 rows
allocations 2026-08-25 13:37 → 2026-08-26 04:48, mostly source=system settlement:<uuid>
```

So order → payment → **allocation** has run on this stack. **VPS** — read with `pg_restore -f -`
inside a `--rm` container against a read-only mount; no server was started and the live database was
not touched.

Cross-referencing the maintainer's timestamped `.env` copies: the stack ran `PHONEPE_ENV=sandbox`
with an 11-character merchant id and `PHONEPE_CHECKOUT_ALLOWED_ORIGINS=https://mercury-uat.phonepe.com`
from 08-25 11:54, and was switched to the production merchant (13-character id, different client-id
fingerprint) at 08-26 11:25. **All seven successful payments fall inside that sandbox window.**
Nothing has succeeded since the switch.

Conclusion unchanged in substance, corrected in cause: no code regressed. A credential change on
08-26 moved the stack from a sandbox merchant that does not enforce the onboarded-domain check to a
production merchant that does.

This also retro-justifies the allowlist change in Entry 027 more strongly than that entry could:
the configuration that demonstrably worked listed `mercury-uat.phonepe.com`, and the repo examples
had lost it. It is not a hypothetical.

**To be unambiguous, because it caused confusion:** the deployed stack still redirects through
`mercury-t2.phonepe.com`, and that is correct. `mercury-uat.phonepe.com` is only ever returned when
`PHONEPE_ENV=sandbox`. Adding it to the allowlists changes nothing about today's behaviour; it only
prevents a fail-closed `GatewayMalformedResponseError` if sandbox is selected later.

### Reproduced under a hard spend cap

The maintainer is testing with real money and capped test amounts at ₹2. `test_e2e/lib/amount-guard.mjs`
now enforces that (D-055). Re-ran `vps-qr-400-body.mjs` at ₹1:

- **VPS** PhonePe rendered "Beonedge LLP", `Total: ₹1.00`, UPI / Debit-Credit Card / Net Banking.
- **VPS** `POST /apis/pg/checkout/ui/v2/pay` → 400, same `INTERNAL_SECURITY_BLOCK_1` body.
- **VPS** order `92dd79b6` created at exactly `100` paise, so the cap held end to end.
- The block is amount-independent: identical at ₹1, ₹500 and ₹50,000.

The three over-cap orders from the Entry 027 run, including the unintended ₹50,000 `04bc5dca`, have
all since moved to `payment_failed`. Nothing is left pending and no money moved.

### A separate confirmed defect: paying from the APK returns to the browser

Reported by the maintainer, confirmed **STATIC** by reading the code. Three independent causes:

1. `clientOrderRoutes.ts:221` passes `redirectUrl: null`, so `phonePeCheckoutGateway.ts:313` falls
   back to `new URL("/dashboard", config.callbackUrl)` → `https://dev-app.beonedge.in/dashboard`.
2. The pay operation has no `redirectUrl` input in the contract, so the client cannot supply a deep
   link.
3. `android/app/src/main/AndroidManifest.xml` declares only `MAIN`/`LAUNCHER` — no `VIEW`,
   `BROWSABLE`, `android:scheme` or `autoVerify` — and nothing in `src/` listens for `appUrlOpen`.

Not fixed here: the choice between verified App Links and a custom scheme has a signing dependency
and is recorded as the open question in D-055.

### Also checked, and not a defect

- `CLIENT_HOME_PATH = "/dashboard"` **is** a real route (`clientRoutes.ts:47` uses
  `path: CLIENT_HOME_PATH`). The redirect target is not a 404. Checked before claiming it was.
- `decideCheckout` / `assertAllowedCheckoutUrl` are **not** dead code — wired in from
  `LumpsumInvestScreen`, `SipStartScreen` and `SipDetailScreen`.
- `9b0ed63` deleted nginx `location = /payment-return` and `32e4764` never restored it, which looks
  like a botched restore. It is not: the same commit deleted `paymentReturnRoutes.ts` and
  `paymentReturnToken.ts` and those were not restored either. nginx and the backend agree the route
  does not exist; re-adding the nginx block would proxy to nothing.

### Verification

- **TESTED** the spend cap refuses ₹3, ₹500, ₹50,000, `₹50,000`, `0`, empty and junk, allows ₹0.5–₹2,
  and cannot be raised via `BOE_TEST_AMOUNT` (2.5 and 500 both refused).
- **TESTED** the cap's first form was too blunt — it scanned the whole page body and so tripped on the
  "Common amounts" preset chips (₹1,000). It now reads the payable total that follows the
  "You are investing" label and **fails closed** if it cannot read it.
- **TESTED** `frontend_stack_ts`: tsc clean, eslint clean, 186 tests. `backend_controller`: eslint
  clean, 756 tests, branch coverage 80.08% ≥ 80% gate. `./release_manager/verify.sh` 108/0/1.
- **VPS** all VPS reads were read-only: `.env` snapshots, `paths.json`, nginx configs, the live DB and
  the 0.11.6/0.11.8 dumps. Nothing deployed, restarted or modified.

### Not verified

- **UNVERIFIED** that a payment completes against the **production** merchant. Still impossible from
  this domain.
- **UNVERIFIED** the sandbox path end to end *today*. It is evidenced by the 08-25 dump rather than by
  a request made now; re-running it needs the sandbox credentials put back and
  `https://mercury-uat.phonepe.com` added to the deployed `.env` by hand.
- **UNVERIFIED** the APK return-to-app path, which currently cannot work at all — no deep link is
  registered. Nothing about it has been changed, so there is nothing to test yet.


## Entry 029 — the checkout return URL is configurable, so payments can transact from the approved host · 2026-08-29

PhonePe confirmed Entry 028's diagnosis in writing, unprompted:

```
URL used to receive payments: https://dev-app.beonedge.in/
Approved URL: www.beonedge.in
```

That is the `INTERNAL_SECURITY_BLOCK_1` body restated in prose, including the trailing-slash origin
form, and it corroborates the inference in D-055: PhonePe reads the merchant's transacting URL from
the **origin of `merchantUrls.redirectUrl`**, the only field in the pay payload carrying a domain.

### What changed

**`PHONEPE_CHECKOUT_REDIRECT_URL`.** The browser return destination is now its own setting instead of
being derived from `PHONEPE_CALLBACK_URL`. It had to be: `canonicalUrl()` pins the callback to this
stack's own host, which is right for a webhook — the callback must reach the backend that owns the
payment records — and wrong for a browser destination that has to sit on a PhonePe-approved host.

- `environment.ts` — new `browserRedirectUrl()` validator. HTTPS only, no embedded credentials, no
  fragment, **host deliberately unconstrained**. Defaults to `new URL("/dashboard", callbackUrl)`,
  which is exactly the behaviour that predates it, so an unmodified deployment is unaffected.
- `phonePeCheckoutGateway.ts` — `PhonePeGatewayConfig.checkoutRedirectUrl`, used as the fallback for
  `command.redirectUrl`.
- `composition.ts` — the *second* copy of `new URL("/dashboard", callbackUrl)` at the AutoPay route
  wiring now reads the same config value. Two independent derivations of the same URL was the kind of
  duplication that drifts.
- Four env examples, split by stack: `.../pay/return/dev` for the dev pair, `.../pay/return/app` for
  the production pair.

**`boe_landing`: `src/app/pay/return/[target]/route.ts`.** The approved host is `www.beonedge.in`,
which the landing site serves, so checkout returns there and this route forwards into the app. The
target is a **closed map** (`dev`, `app`) with a 404 fallback — not a `?to=` parameter, which would be
an open redirect on an approved payment domain and a gift to a phisher. Query parameters PhonePe
appends are carried through; the destination itself is fixed. `force-dynamic` and `Cache-Control:
no-store` because Cloudflare fronts that host.

No nginx change is needed: `www.beonedge.in` already 301s to the apex preserving `$request_uri`, so
`www/pay/return/dev` → `beonedge.in/pay/return/dev` → the app. Verified live with `curl -I`.

### Verification

- **TESTED** `backend_controller`: tsc clean, eslint clean, **772** tests (756 before), branch
  coverage 80.25% against the 80% gate.
- **TESTED** the new behaviour is actually observable, not just configurable: the gateway test's
  `CONFIG.checkoutRedirectUrl` is on a *different host* from `CONFIG.callbackUrl`, and the test asserts
  the outgoing payload carries the former and that the two hosts differ. Before this change that
  assertion was `https://app.example/dashboard` — derived from the callback — and it failed when the
  change landed, which is how I know the test was pinning real behaviour rather than restating it.
- **TESTED** validation refuses cleartext, relative URLs, embedded credentials
  (`https://user:pass@www.beonedge.in/...`) and fragments; accepts a cross-host URL and preserves a
  query string.
- **TESTED** `boe_landing`: tsc clean, `npx vitest run` 87 tests across 6 files (7 of them new, for this
  route), and `npx next build` registers `/pay/return/[target]` as **ƒ Dynamic** — server-rendered on
  demand rather than statically prerendered, which a cached redirect would have been.
- **TESTED** the route cannot be turned into an open redirect. `?to=`, `?redirect=//evil.test` and a
  URL-encoded `?next=` all still land on `dev-app.beonedge.in`; a hostile path segment (`../app`,
  `dev/../../evil`, `https://evil.test`, empty) 404s rather than redirecting.
- **VPS** `curl -I https://www.beonedge.in/` returns `301 → https://beonedge.in/`, and nginx
  `boe-landing` serves both names. Read-only.

### Not verified

- **UNVERIFIED, and this is the point of the exercise:** that PhonePe accepts a redirect on the
  approved host and lifts the block. The inference is strong — the referrer was ruled out
  experimentally in Entry 028 and `redirectUrl` is the only remaining domain-bearing field — but no
  successful payment has been observed. Confirming it needs `PHONEPE_CHECKOUT_REDIRECT_URL` set in the
  deployed `.env`, the landing site redeployed with the new route, and a ₹1 payment.
- **VPS** the route is deployed and verified over the network. `boe_landing` `82f56b0` pushed to
  `origin/dev/tamagami-hi`, fast-forwarded on the VPS at `/srv/dev_stack/BOE_LANDING/repo`
  (`9c7de73..82f56b0`, untracked `docker-compose.override.yml` left intact), `docker compose build
  landing` then `up -d landing`; healthy in ~10s. Only the `landing` service runs — the compose `nginx`
  service is unused, host nginx proxies `127.0.0.1:47410` — so exactly one container was recreated.

  ```
  curl -sSIL https://www.beonedge.in/pay/return/dev
    301 → https://beonedge.in/pay/return/dev
    302 → https://dev-app.beonedge.in/dashboard   cache-control: no-store
    200
  /pay/return/app                  → 302 https://app.beonedge.in/dashboard
  /pay/return/dev?code=…&merchantOrderId=… → 302 …/dashboard?code=…&merchantOrderId=…
  /pay/return/evil                 → 404, no location header
  /pay/return/dev?to=https://evil.test&redirect=//evil.test
                                   → 302 https://dev-app.beonedge.in/dashboard?to=…&redirect=…
  ```

  The last one is the one worth keeping: the hostile values survive as inert query parameters on our
  own host and cannot move the destination. The `www` → apex 301 preserving the request URI is
  confirmed rather than assumed, which is what made the nginx change unnecessary.
- The maintainer may instead simply add `dev-app.beonedge.in` as an approved URL on the PhonePe
  dashboard, which needs none of this. Both routes are now open; this one also serves production,
  where the host is `app.beonedge.in` and the same block applies.

### Source comments removed at the maintainer's instruction

The maintainer asked for no comments in source files, and for a script rather than hand-editing.
`tools/strip-comments.mjs` uses the TypeScript parser to find exact comment ranges — a regex approach
corrupts `//` inside URLs, regex literals and template strings, all of which occur in this codebase.
It preserves directive comments (`eslint-disable`, `@ts-expect-error`, `prettier-ignore`, coverage
ignores, license headers), is dry-run by default, and skips `node_modules`, `dist`, `build`, `.next`.

**TESTED** against a fixture containing a URL with `//`, a template literal with `// not a comment`, a
regex `/https?:\/\/[^/]+\/\//u`, chained division, and an `eslint-disable-next-line`: all five real
comments removed, everything else byte-identical, and the result still typechecks.

Applied so far only to files authored in this session (28 comments) plus my own additions to
`originExamples.test.ts` and `composition.test.ts`, spliced so the pre-existing header comments in
those two files were left intact. A repo-wide sweep would remove **1,073 comments across 150 files
(197 KB)** and is deliberately **not** done: much of it records why a given check exists, and the
entries in this log cross-reference it. Awaiting an explicit decision.


## Entry 030 — the APK was stuck re-prompting for a fingerprint forever · 2026-08-29

Reported from a device: the biometric prompt reappears immediately after a successful
authentication, so the app never opens. This is the first time the device-lock path has been
exercised on hardware — Entry 026 listed it as first-run and unverified — and it does not work.

### Two defects, and it takes both to loop

**`unlockDevice()` put the system into the one state that demands a lock.** `shouldLock` treats
`leftAt === null` on a `resume` as "the time away cannot be established, so lock", which is the right
conservative rule and is covered by its own test. But `unlockDevice()` set `leftAt = null`. So the
state immediately after unlocking was indistinguishable from a resume with no recorded departure, and
the next `resume` locked again.

**The biometric prompt guarantees a resume event.** Android's prompt takes focus, so Capacitor's `App`
plugin fires `appStateChange(isActive:false)` when it opens and `isActive:true` when it closes.
`DeviceLockGate` treated that as the user leaving and returning. So around every unlock there is
always a `resume` in flight, and whether it lands before or after `unlockDevice()` is a race:

```
cold-start  -> shouldLock(trigger:"cold-start") is unconditionally true -> lock
LockScreen  -> biometric prompt opens
              appStateChange(false) -> recordDeviceLeft(T)
user authenticates
              unlockDevice() -> leftAt = null, unlocked
              appStateChange(true) -> evaluate("resume") -> leftAt null -> LOCK
LockScreen remounts, biometricRequested ref is fresh -> prompt again -> forever
```

The fresh `biometricRequested` ref on each remount is what turns a single bad decision into an
unbreakable loop rather than one spurious lock.

### The fix

`unlockDevice(at = Date.now())` now **records** the moment of unlocking instead of clearing it, so a
resume straight afterwards computes an idle time near zero and does not lock. `shouldLock` and its
eight tests are untouched — the rule was never wrong, the state fed to it was.

Separately, a native prompt we opened ourselves no longer counts as leaving the app.
`beginNativePrompt()` / `endNativePrompt()` bracket the `verifyBiometric` call in `LockScreen`, and
while the depth is above zero `DeviceLockGate` ignores `appStateChange` in both directions and
`recordDeviceLeft` is a no-op. This is what makes a slow authentication safe: without it, taking
longer than the 120s idle threshold to present a finger would re-lock on return even with the first
fix in place.

Leaving the app for something we did *not* open — PhonePe checkout, the launcher — still records a
departure and still locks after the threshold. That behaviour is deliberate and unchanged.

### Verification

- **TESTED** `src/app/native/deviceLock.test.ts`, 11 new tests. Three reproduce the loop directly: the
  resume arriving after the unlock, arriving before it, and an authentication slower than the idle
  threshold.
- **TESTED** the fix is not vacuous. Reverting `unlockDevice` to `lastSeenAt = null` fails **5** of the
  11, including all three loop cases; restoring it passes all 11. A test that cannot fail would have
  been worthless here, since the whole defect was a state transition nothing observed.
- **TESTED** the conservative rule is still intact: `leftAt: null` on a resume still locks, asserted
  explicitly so a future change cannot "fix" the loop by weakening the security property instead.
- **TESTED** `frontend_stack_ts`: tsc clean, eslint clean, **197** tests across 20 files (186 before),
  `vite build` clean.

### Not verified

- **UNVERIFIED on device.** This is the important one: the defect was only found on hardware and the
  fix has only been proven in tests. The event ordering I inferred from the symptom is consistent with
  Capacitor's documented `appStateChange` behaviour, but I have not watched the events on a device. A
  rebuilt APK has to be installed and the sequence walked: cold start, authenticate, reach the
  dashboard; then background the app briefly and return without a prompt; then background it for over
  two minutes and confirm the prompt does return.
- **UNVERIFIED** the PIN path around the same race. `verifyDevicePin` does not open a native prompt so
  it never produced the loop, but nothing has exercised it on hardware either.
- The `cold-start` trigger locking unconditionally means any remount of `AppProviders` re-locks. Not
  changed, and not observed to happen, but it is the remaining way to get an unexpected prompt.


## Entry 031 — the redirect-URL theory is disproven; the block is inside PhonePe · 2026-08-29

Entry 029 and D-056 rested on an inference: that PhonePe derives the merchant's transacting URL from
the origin of `merchantUrls.redirectUrl`. That inference is **wrong**, and the change built on it does
not fix anything.

### What was deployed, and what happened

The maintainer deployed it correctly — this is not a deployment mistake:

```
PHONEPE_CHECKOUT_REDIRECT_URL=https://www.beonedge.in/pay/return/dev   set in the deployed .env
boe-dev-backend:0.12.2 built 18:53, /app/dist contains the new key
parseServerConfig on the live env resolves checkoutRedirectUrl = https://www.beonedge.in/pay/return/dev
```

A fresh ₹1 order (`6b70bf69`, its own `paymentId`) got a fresh token, and PhonePe returned the
identical body it always has:

```json
{"errorCode":"INTERNAL_SECURITY_BLOCK_1","isRetryEnabled":false,
 "data":{"Onboarding_URL":["www.beonedge.in"],"Transacting_URL":"https://dev-app.beonedge.in/"}}
```

The backend now sends `www.beonedge.in` as the redirect and PhonePe still reports
`dev-app.beonedge.in` as the transacting URL. That single observation kills the theory.

### Where it actually comes from

`test_e2e/vps-phonepe-request.mjs` captures the POST body of the failing call. The browser sends:

```
POST https://api.phonepe.com/apis/pg/checkout/ui/v2/pay
  referer: https://mercury-t2.phonepe.com/
  origin : null
  body   : {"type":"UPI_QR"}
  beonedge hostnames in body: NONE
```

No hostname of ours, in any form, and the referer is PhonePe's own page. So `Transacting_URL` is
resolved **server-side inside PhonePe** — from the merchant record, or from something bound to the
token that our payload does not control. Three things are now each independently ruled out:

| candidate | ruled out by |
| --- | --- |
| the browser's `Referer` | Entry 028's three-arm probe: unchanged with no referer, and when claiming `www.beonedge.in` |
| `merchantUrls.redirectUrl` | this entry: changed to the approved host, `Transacting_URL` unchanged |
| anything the browser sends | this entry: the request body carries no hostname at all |

**There is no code change in this repository that can lift this block.** I said in Entry 029 that this
was unproven and that the dashboard was the certain route; that caveat was correct and the experiment
has now settled it in the dashboard's favour.

### Consequences

`PHONEPE_CHECKOUT_REDIRECT_URL` on the VPS should be **unset**, returning the default
`https://dev-app.beonedge.in/dashboard`. Pointing the return through `www.beonedge.in` now buys
nothing and inserts two redirect hops through the marketing site into the payment return path.

The setting itself is kept. It is not dead: `canonicalUrl` pins the callback to the stack's own host
and there is no other way to express a return on a different host, which production may still need.
Its default is the previous behaviour, so an unset key behaves exactly as before the change.

The landing route `boe_landing` `src/app/pay/return/[target]` is left in place but is **unused** while
the key is unset. It is 91 lines, tested, and reachable only by direct request. Flagged for the
maintainer to decide: keep it as the standing option, or remove it.

### What actually fixes the payments

1. **PhonePe dashboard** — Help → "Unable to receive customer payments?" → Contact Us → Update URL, and
   add `dev-app.beonedge.in`, plus `app.beonedge.in` for production. This is what PhonePe's own email
   instructed. Certain, and needs no code.
2. **Sandbox credentials on the dev stack** — the configuration that demonstrably worked on 2026-08-25
   (Entry 028: 7 succeeded payments, 7 allocations). Needs `PHONEPE_ENV=sandbox` plus sandbox
   credentials; the allowlist already carries `https://mercury-uat.phonepe.com`. This is the one the
   maintainer can do without waiting on PhonePe.

### Verification

- **VPS** deployed env and image inspected read-only; `parseServerConfig` run against the live `.env`
  inside the deployed image, confirming the new redirect is active.
- **TESTED / VPS** `vps-pay-response.mjs` intercepts the `/pay` response with `page.route` before the
  navigation destroys it, proving a fresh `orderId`/`paymentId`/token rather than a replayed one. Worth
  keeping: the token *prefix* is stable across orders, which looked like a stale checkout until the
  response body showed distinct order and payment ids.
- **TESTED / VPS** `vps-phonepe-request.mjs` captures the outgoing request body, referer and origin.
- **VPS** the ₹2 spend cap held throughout; every order this session was `100` paise.

### Not verified

- **UNVERIFIED** that approving `dev-app.beonedge.in` lifts the block. It follows from PhonePe's own
  message but only they can apply it.
- **UNVERIFIED** the whole settled-payment chain — order → payment → **allocation** → acknowledgement.
  Still zero allocations on this database. This remains the thing to check the moment a payment can
  complete by either route.


## Entry 032 — the redirect really is unrelated, and the registered webhook host is the likely source · 2026-08-29

Entry 031 reached the right conclusion for the wrong reason and I retracted it in `fe4d557`. This entry
re-establishes it properly, and identifies a better candidate for where `Transacting_URL` comes from.

### The retraction, and what fixed it

The compose files enumerate every backend variable as `KEY: ${KEY}`, and
`PHONEPE_CHECKOUT_REDIRECT_URL` was absent, so it never reached the container. `docker exec
boe-dev-backend printenv` returned nothing. Entry 031's experiment had not varied the thing it claimed
to vary.

The check that misled me: `parseServerConfig` run in a *fresh* container with `--env-file`. That reads
the current `.env` directly and bypasses compose, so it proves the file is right and says nothing about
the running process. **`docker exec … printenv` is the check that answers the question**, and it is the
one I skipped.

Applied on the VPS: the missing line added to the deployed compose file (backed up first), validated
with `docker compose config` using the deploy's own invocation — `env -u` every key from the env file,
then `BOE_VERSION=0.12.2 BOE_CONTAINER_PREFIX=boe-dev COMPOSE_PROJECT_NAME=boe_dev` — confirming both
that the file parses and that the backend image still resolves to `boe-dev-backend:0.12.2` rather than a
stale tag. Then `up -d --no-deps backend`; healthy in ~12s, one container recreated.

```
docker exec boe-dev-backend printenv PHONEPE_CHECKOUT_REDIRECT_URL
  → https://www.beonedge.in/pay/return/dev
```

### Re-tested, and the answer is unchanged

With the value genuinely in the running process, a fresh ₹1 order still returns:

```json
{"errorCode":"INTERNAL_SECURITY_BLOCK_1","isRetryEnabled":false,
 "data":{"Onboarding_URL":["www.beonedge.in"],"Transacting_URL":"https://dev-app.beonedge.in/"}}
```

So `merchantUrls.redirectUrl` does not determine `Transacting_URL`. This time the experiment actually
varied it. The chain is: `printenv` proves the value is in the process; `createCheckout` uses
`command.redirectUrl ?? config.checkoutRedirectUrl` with `clientOrderRoutes` passing `null`; and
`phonePeCheckoutGateway.test.ts` asserts the outgoing payload carries `config.checkoutRedirectUrl` on a
host deliberately different from the callback host. The backend is sending `www.beonedge.in`.

**A near-miss worth recording.** `vps-checkout-knows-redirect.mjs` scans PhonePe's responses for our
hostnames and reported "PhonePe knows www.beonedge.in: true", which reads like proof the redirect
arrived. It is not. The only response containing either hostname is the error body itself, where
`www.beonedge.in` is the `Onboarding_URL`. The script's own verdict is wrong and the test is
inconclusive on that point; the conclusion above rests on `printenv` plus the unit-tested code path
instead.

### The better hypothesis: the registered webhook URL

`PHONEPE_CALLBACK_URL` is `https://dev-app.beonedge.in/api/v1/provider-events/phonepe/payment`. Its
origin is `https://dev-app.beonedge.in/` — character for character, including the trailing slash, what
PhonePe reports as `Transacting_URL`.

And it is **never sent in any request**. `grep callbackUrl src/providers/phonepe/*.ts` finds only the
config field declaration; the pay payload contains exactly `merchantOrderId`, `amount`, `expireAfter`
and `paymentFlow.merchantUrls.redirectUrl`. So the webhook URL reaches PhonePe only as **dashboard
state**, which is precisely the property the observed value has: unchanged by anything we send.

Not proven. It is now the best-supported candidate, and unlike the last one I am not writing code for it
first. Two cheap ways to settle it, both on PhonePe's side: ask support what determines
`Transacting_URL`, or change the registered webhook host and observe. If it holds, centralising on
`beonedge.in` is achievable — register the webhook under the approved host and proxy that path to the
backend — but it would need `PHONEPE_CALLBACK_URL` decoupled from `canonicalUrl`'s host pin, the same
treatment `PHONEPE_CHECKOUT_REDIRECT_URL` got, and it should not be built before the hypothesis is
confirmed.

### Verification

- **VPS** compose edit backed up, validated, backend recreated, `printenv` confirms the value, stack all
  healthy.
- **TESTED / VPS** fresh ₹1 order, `Transacting_URL` unchanged.
- **TESTED** `envPassthrough.test.ts`, 5 tests: every key a stack `.env.example` declares that the
  backend schema also declares must appear as a compose substitution. Zero pre-existing violations, so
  this was the only instance. Deleting the compose line fails 3 of the 5.
- **TESTED** backend tsc and eslint clean, 777 tests, branch coverage 80.25% against the 80% gate,
  `verify.sh` 108/0.
- **VPS** spend cap held: every order this session was `100` paise.

### Not verified

- **UNVERIFIED** that the registered webhook URL is the source of `Transacting_URL`. Hypothesis only.
- **UNVERIFIED** that approving `dev-app.beonedge.in` lifts the block, though it follows from PhonePe's
  own message and remains the certain route.
- **UNVERIFIED** the settled-payment chain. Still zero allocations on this database.
- The workers were **not** recreated, so they still lack `PHONEPE_CHECKOUT_REDIRECT_URL`. Harmless: the
  compose default is empty and the config field is optional. A full deploy aligns them.


## Entry 033 — every input we control has now been varied; the block is PhonePe's record · 2026-08-29

Phase 0 of `PLAN/payments-via-approved-domain.md` ran and **failed to move `Transacting_URL`**. That is
the useful outcome: it kills the migration before any of it was built.

### What was done

- nginx on the approved host proxies `/api/v1/provider-events/phonepe/{payment,subscription}` to the
  backend. Verified over the network: `401 PROVIDER_CALLBACK_UNVERIFIED` on `www.beonedge.in`, on the
  apex, and on `dev-app` — identical, which is the backend's route correctly refusing an unsigned probe.
- The maintainer re-registered the PhonePe webhook as
  `https://www.beonedge.in/api/v1/provider-events/phonepe/payment`.
- Fresh ₹1 order.

```json
{"errorCode":"INTERNAL_SECURITY_BLOCK_1","isRetryEnabled":false,
 "data":{"Onboarding_URL":["www.beonedge.in"],"Transacting_URL":"https://dev-app.beonedge.in/"}}
```

Unchanged.

### Four independent inputs, all eliminated

| input | varied to | result |
| --- | --- | --- |
| browser `Referer` | absent, and `https://www.beonedge.in/` | unchanged (Entry 028) |
| `merchantUrls.redirectUrl` | `https://www.beonedge.in/pay/return/dev`, confirmed in-process by `printenv` | unchanged (Entry 032) |
| browser request payload | inspected: `{"type":"UPI_QR"}`, no hostname of ours | n/a (Entry 032) |
| registered webhook URL | `https://www.beonedge.in/...` on the dashboard | unchanged (this entry) |

`Transacting_URL` is therefore a value **stored against the merchant inside PhonePe** — consistent with
their email describing it as the URL "you are using to receive payments" against the one "approved and
mentioned in your Terms & Conditions document". It is a record, not a function of the request.

### Consequence for the migration, which is the point of Phase 0

**Do not build Phases 1–4.** PhonePe cannot distinguish the proxy from the relay: both put every
PhonePe-facing URL on `www.beonedge.in`, and that has now been shown not to matter. Copying payment
processing into `boe_landing` would have moved merchant credentials into the public marketing
deployment and put a service boundary through the webhook → allocation transaction, in exchange for
nothing. The plan document stays in the tree with this entry referenced from it, because the design is
sound if the constraint ever changes — it is the premise that is dead, not the architecture.

### What is left, and it is only PhonePe

1. **Ask PhonePe to approve the subdomains.** Their email gives the path: Help → "Unable to receive
   customer payments?" → Contact Us → Update URL. Request `dev-app.beonedge.in` **and**
   `app.beonedge.in` in one go, and ask whether subdomains of an already-approved parent can be added
   without the full 14-day re-verification. `Onboarding_URL` is a JSON array, so more than one is
   expressible.
2. **Use sandbox credentials for dev in the meantime.** Proven on 2026-08-25: 7 succeeded payments and
   7 allocations. Needs `PHONEPE_ENV=sandbox` plus sandbox credentials; the allowlist already carries
   `https://mercury-uat.phonepe.com`.

### What to keep

The nginx proxy and the webhook on `www` are **kept**, not reverted. They cost nothing, they are
verified, and they are the only configuration under which the stored value could ever refresh to the
approved host. Reverting would mean redoing a privileged reload later for no gain.

`PHONEPE_CHECKOUT_REDIRECT_URL` on the VPS is now pointless indirection — two redirect hops through the
marketing site on the payment return. Recommended to unset it, restoring the default
`https://dev-app.beonedge.in/dashboard`. Env-only, no rebuild.

### Verification

- **VPS** proxy verified by request on both hostnames and compared against `dev-app`; marketing site
  unaffected (`www` → apex 301, apex 200); `/api/v1/client/orders` and the auth routes still 404 on the
  approved host, so only the callback paths are exposed.
- **TESTED / VPS** fresh ₹1 order after the webhook change; `Transacting_URL` unchanged.
- **VPS** spend cap held; every order this session was `100` paise.

### Not verified

- **UNVERIFIED** that PhonePe approving the subdomain lifts the block. It follows from their own
  message and is now the only remaining lever.
- **UNVERIFIED** the settled-payment chain. Still zero allocations on this database. Whichever route
  unblocks payments, that is the thing to check: order → payment → allocation → acknowledgement.

### A process note on how this went

Three hypotheses were tested in sequence and two produced code before they were tested — the redirect
URL (D-056, reverted in premise by Entry 032) and the callback host (D-058, inert per this entry). The
referrer probe in Entry 028 cost nothing and eliminated a candidate outright. The lesson is the ordering:
each of these could have been settled by one ₹1 order and a `printenv` before any file was edited. The
one genuine defect the detour did surface is real and worth keeping — `envPassthrough.test.ts`, closing
the compose-passthrough gap that made a whole experiment silently test nothing.


## Entry 034 — the full migration works, and does not lift the block · 2026-08-29

The centralized payment service is live on the approved domain and `boe_app` makes **no PhonePe calls
at all** for one-time payments. `Transacting_URL` is unchanged. This is the end of the investigation:
every input we control has now been varied, including the one the whole architecture existed to vary.

### What is deployed

- `boe-payment-service` in the `boe_landing` stack, behind a compose `payments` profile: the PhonePe
  adapter copied verbatim out of `boe_app`, HMAC service auth, event normalization, single-use browser
  sessions. Healthy.
- `boe_app` v0.12.4 selecting `relayPaymentGateway` via `PAYMENTS_SERVICE_URL` /
  `PAYMENTS_SERVICE_SECRET` / `PAYMENTS_SERVICE_NAME`. Secrets confirmed matching across both stacks
  (fingerprint `1cd48425d1c6`).
- nginx on `www.beonedge.in` and the apex serving `/pay/start`, `/payment-return`, `/pay/go`,
  `/pay/return/` and the two PhonePe callback paths. The `www` block serves them directly now, so the
  earlier 301-to-apex hole is closed.
- The payment service attached to `boe_dev_frontend`, so the backend reaches it by container name over
  a private network. The internal API answers 404 on the apex and is not publicly routable.

### It works, and that part is proven

```
POST /api/v1/client/orders/{id}/pay
  → {"checkout":{"type":"redirect","url":"https://www.beonedge.in/pay/start?t=…"}}

payment service log
  merchantOrderId=boe_f6a4134814ed…  providerOrderId=OMO2608300159593833316455W  "checkout created"
  merchantOrderId=boe_f6a4134814ed…  service=boe-dev  "payer handed to the provider from the approved origin"

backend log, last 5 minutes
  phonepe-related lines: 0
```

`boe_app` returned a URL on the approved domain, the service created the PhonePe order, and the
backend made zero provider calls. That is spec §47's target for one-time payments, reached.

### And the block is unchanged

```json
{"errorCode":"INTERNAL_SECURITY_BLOCK_1","isRetryEnabled":false,
 "data":{"Onboarding_URL":["www.beonedge.in"],"Transacting_URL":"https://dev-app.beonedge.in/"}}
```

### Six inputs, all eliminated

| input | varied to | entry |
| --- | --- | --- |
| browser `Referer` | absent, and `www.beonedge.in` | 028 |
| `merchantUrls.redirectUrl` | the approved host, confirmed in-process | 032 |
| browser request payload | inspected: no hostname of ours at all | 032 |
| registered webhook URL | the approved host, on the dashboard | 033 |
| the browser's whole origin chain | app → `www.beonedge.in/pay/go` → provider | (this session) |
| **which server calls PhonePe** | the service on the approved domain; `boe_app` calls it zero times | **034** |

`Transacting_URL` is state inside PhonePe's merchant record. It is not derived from the request, the
browser, the dashboard webhook, or the identity of the calling process. Only PhonePe can change it.

### So the only remaining actions are PhonePe's

1. Approve `dev-app.beonedge.in` and `app.beonedge.in`, **and** ask them to reset the recorded
   transacting URL, quoting the block body. Help → "Unable to receive customer payments?" → Contact Us
   → Update URL.
2. For the 3 September deadline, dev testing runs on sandbox credentials — the configuration proven
   working on 2026-08-25 with 7 succeeded payments and 7 allocations. `PHONEPE_ENV=sandbox` plus
   sandbox credentials; `mercury-uat.phonepe.com` is already allowlisted. Under the relay this is a
   per-caller setting: `phonepeEnv` in `PAYMENT_CALLERS`, so dev can be sandbox while production stays
   production without touching code.

### What the migration is still worth

It is not wasted, but it should be judged on its own merits rather than as a fix:

- PhonePe credentials exist in one service instead of every app stack.
- One integration point serves both the dev and production apps, so a second app costs no PhonePe work.
- `boe_app` speaks a provider-neutral contract, which is §43's replaceability without building
  multi-provider support.

### Not verified, and the honest gaps

- **UNVERIFIED** that a payment completes. It cannot, from this merchant, until PhonePe acts.
- **UNVERIFIED** the callback leg through the service. Callbacks still route to the backend in nginx and
  no payment has ever settled, so the normalization and forwarding path has only unit tests.
- **UNVERIFIED** the settled chain: order → payment → **allocation** → acknowledgement. Still zero
  allocations on this database.
- **AutoPay is untouched.** `createPhonePeRecurringGateway` still calls PhonePe directly, so `PHONEPE_*`
  remains required in `boe_app` and §5's "zero PhonePe knowledge" is not yet true. Deliberate: it
  roughly doubles the surface and there is no reason to move it before the block is resolved.
- The payment service's attachment to `boe_dev_frontend` was made with `docker network connect` and is
  not declared in compose. It survived this deploy but will not survive the network being recreated.
  It needs declaring as an external network before this is anything but a test rig.

### The process lesson, recorded plainly

Six hypotheses, tested in sequence, each one costing more than the last. The two cheapest — the
referrer probe and the request-body capture — were pure observation and eliminated candidates outright.
The three most expensive each produced code first: `PHONEPE_CHECKOUT_REDIRECT_URL`, the callback-host
relaxation, and this migration. Every one of them could have been settled by an experiment before a
file was edited, and in the case of the redirect URL the first experiment was invalid because a compose
passthrough was missing, which cost a full retraction. The durable output is `envPassthrough.test.ts`:
a key the backend reads that compose does not pass is now a failing test rather than a silent no-op.

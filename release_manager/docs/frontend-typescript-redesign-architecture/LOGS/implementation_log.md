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

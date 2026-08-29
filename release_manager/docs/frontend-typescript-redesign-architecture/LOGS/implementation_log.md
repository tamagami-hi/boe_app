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

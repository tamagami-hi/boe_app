# Migration Metrics

## Current Snapshot After `9e884ad`

| Area | Production TS/TSX | Test TS/TSX | Tooling/operational TS | Remaining authored JS/JSX |
|---|---:|---:|---:|---:|
| Contracts | 857 lines / 9 files | 1,641 lines / 6 files | Config tracked separately | 0 |
| Backend migrated runtime | 209 lines / 4 files | 271 lines / 5 files | 88-line smoke script + 22-line Vitest config | 12,600 lines / 89 files |
| Landing | 3,345 lines / 55 files | 222 lines / 3 files | TS config plus 34-line `next.config.mjs` | 0 authored JS/JSX |
| Other frontend authored source | Not yet migrated in this program | One JS test is included in backlog | Existing package tooling | 20,480 lines / 188 files |

Backend remaining JS breakdown: 85 production/operational files and 4 test
files. The completed runtime packet deleted 164 production/operational JS lines
and 47 JS test lines (211 total) while adding 209 production TS, 88 operational
TS, 271 test TS, and 22 tooling-config TS lines.

Frontend authored JS/JSX backlog:

| Package | Files | Lines |
|---|---:|---:|
| Vite app source + `vite.config.js` | 6 | 257 |
| Admin source | 77 | 9,212 |
| Client source | 76 | 8,223 |
| Shared source | 23 | 1,522 |
| Design tokens | 1 | 2 |
| UI kits | 5 | 1,264 |
| **Total** | **188** | **20,480** |

Global literal JS/JSX backlog is 277 files / 33,080 lines: 272
production/config files / 32,433 lines and five tests / 647 lines. Four active
MJS tooling/config files add 96 lines, producing a JS-family total of 281 files
and 33,176 lines. See the inventory ledger for classification and exceptions.

## Reproduction Commands

Run from the repository root. Exclude dependency, build, generated Android, and
legacy-session trees from authored-source counts.

```bash
find backend_controller/src backend_controller/scripts -type f \
  \( -name '*.js' -o -name '*.jsx' \) -print0 | xargs -0 wc -l

find backend_controller/src backend_controller/scripts -type f \
  \( -name '*.js' -o -name '*.jsx' \) -print | wc -l

find backend_controller/src backend_controller/scripts -type f \
  -name '*.test.js' -print0 | xargs -0 wc -l

find packages/contracts/src -type f -name '*.ts' ! -name '*.test.ts' \
  -print0 | xargs -0 wc -l

find packages/contracts/src -type f -name '*.test.ts' \
  -print0 | xargs -0 wc -l

find frontend_stack \
  \( -path '*/node_modules' -o -path '*/dist' -o -path '*/build' \
     -o -path '*/.next' -o -path '*/android/app/src/main/assets' \) -prune \
  -o -type f \( -name '*.js' -o -name '*.jsx' \) -print0 | xargs -0 wc -l

find frontend_stack \
  \( -path '*/node_modules' -o -path '*/dist' -o -path '*/build' \
     -o -path '*/.next' -o -path '*/android/app/src/main/assets' \) -prune \
  -o -type f \( -name '*.js' -o -name '*.jsx' \) -print | wc -l

find frontend_stack/packages/landing_page \
  \( -path '*/node_modules' -o -path '*/.next' \) -prune \
  -o -type f -name '*.test.ts' -print0 | xargs -0 wc -l

find backend_controller packages/contracts frontend_stack \
  \( -path '*/node_modules' -o -path '*/dist' -o -path '*/build' \
     -o -path '*/.next' \) -prune -o -type f -name '*.mjs' -print0 \
  | xargs -0 wc -l

find frontend_stack/app/android/app/src/main/assets/public -type f -name '*.js' \
  -printf '%s\n' | awk '{ files += 1; bytes += $1 } END { print files, bytes }'
```

For the backend production/test split, subtract the `*.test.js` result from the
total or list both sets with `find`. For landing production TS/TSX, count its
`src` TS/TSX set and exclude `*.test.ts`; the inventory ledger records the exact
snapshot. Generated Android byte counts are diagnostic only and never enter the
authored-source total.

Each completed packet appends a new snapshot or delta. Do not overwrite a prior
checkpoint's figures without recording the correction and reason.

## Delta: BE-002 Graceful API Lifecycle (branch `dev`)

Additive runtime hardening; deletes no JavaScript.

| Change | Lines |
|---|---:|
| Production TS added (`src/runtime/shutdown.ts`) | +127 |
| Production TS changed (`src/server.ts` main block) | +12 / -5 |
| Test TS added (`src/runtime/shutdown.test.ts`, 9 tests) | +185 |
| Tooling TS changed (`scripts/smoke-entrypoint.ts`) | +40 / -8 |
| Production JS/JSX deleted | 0 |
| Test JS/JSX deleted | 0 |

Backend migrated runtime after BE-002: ~348 production TS lines (4 prior + new
`shutdown.ts`), 456 test TS lines, plus operational smoke/config TS. Remaining
authored backend JS/JSX backlog is unchanged at 89 files / 12,600 lines; the
global JS-family backlog figures are unchanged because BE-002 deleted no JS.
`npm run check`: 27 tests, 93.69% stmts / 91.89% branch / 90.9% funcs.

## Delta: CON-006 Deterministic OpenAPI Generator (branch `ts-migration/backend`)

Additive in `packages/contracts`; deletes no JavaScript.

| Change | Value |
|---|---:|
| Tooling TS added (`scripts/generate-openapi.ts`) | +133 lines |
| Test TS added (`src/openapi.test.ts`, 7 tests) | +84 lines |
| Committed generated `openapi-v1.json` | 59 KB |
| Committed generated `openapi-v1.d.ts` | 33 KB |
| Production JS/JSX deleted | 0 |

Contracts package after CON-006: 120 tests, 100% coverage on all four metrics,
0 vulnerabilities. Exact deps added: `@asteasolutions/zod-to-openapi` 9.0.0,
`openapi-typescript` 7.13.0, `@redocly/cli` 2.39.0, `tsx` 4.23.1;
`openapi-fetch` removed (deferred to CON-007). Backend authored JS/JSX backlog
unchanged at 89 files / 12,600 lines. `eslint.config.mjs` classified as a
tooling exception (one of the 4 MJS files in the inventory ledger).

## Delta: BE-003 Runtime Configuration Closure (branch `ts-migration/backend`)

First backend JavaScript deletion of the migration program.

| Change | Value |
|---|---:|
| Production JS deleted | 3 files / ~208 lines |
| Test TS changed (`runtime-boundary.test.ts`) | +1 deletion-guard test |
| Production/Test TS added | 0 (typed replacement pre-existed in BE-001) |

Deleted `src/config/env.js` (~140), `src/config/dotenv.js` (~40),
`src/shared/logger.js` (~28). Backend authored JS/JSX backlog: **89 -> 86 files,
12,600 -> ~12,392 lines**. `npm run check` green; no behavior change. Typed
`runtime/environment.ts` + `runtime/logger.ts` (BE-001) are the sole config/
observability authority.

## Delta: BE-004 PostgreSQL/Kysely Foundation (branch `ts-migration/backend`)

Additive persistence foundation; deletes no JavaScript (per BE-004 boundary).

| Change | Value |
|---|---:|
| Production TS added (`src/db/config.ts`, `pool.ts`, `database.ts`, `types.ts`) | ~110 lines |
| Unit test TS added (`db/config.test.ts` 4, `db/database.test.ts` 2) | 6 tests |
| Integration test TS added (`test/integration/database.integration.test.ts`) | 3 tests |
| Tooling TS added (`with-container-runtime.ts`, `vitest.integration.config.ts`) | 2 files |
| Production JS/JSX deleted | 0 |

Backend runtime after BE-004: unit suite 34 tests, 93.93% stmts / 93.02% branch
/ 88.23% funcs; integration 3/3 against PostgreSQL 16 via Testcontainers. Deps
(exact): `kysely` 0.29.3, `pg` 8.22.0, `@types/pg` 8.20.0, `testcontainers`
12.0.4, `@testcontainers/postgresql` 12.0.4; 0 vulnerabilities. Backend authored
JS/JSX backlog unchanged at 86 files. Native `ssh2`/`cpu-features` install
scripts denied (optional, unused); `protobufjs` approved.

## Delta: BE-005 Migration/Check Tooling (branch `ts-migration/backend`)

| Change | Value |
|---|---:|
| Production TS added (`src/scripts/migrate.ts`, `check-db.ts`) | ~155 lines |
| Test TS added (`migrate.test.ts` 5, `check-db.test.ts` 2, +1 integration, +1 guard) | ~9 tests |
| Production JS deleted (`migrate.js`, `check-db.js`, `seed-auth.js`) | 3 files |

Backend authored JS/JSX backlog: **86 -> 83 files**. Unit suite 42 tests,
overall 87.69% stmts / 92.18% branch / 90.9% funcs; integration 4/4 vs
PostgreSQL 16. Cumulative backend JS deleted by this program: BE-001 (server/
launcher) + BE-003 (3 config/logger) + BE-005 (3 DB scripts).

## Delta: BE-007a Canonical Public-Onboarding Schema (branch `ts-migration/backend`)

Additive schema; deletes no JavaScript.

| Change | Value |
|---|---:|
| Migration SQL added (`009_canonical_onboarding.sql`: 4 tables, 2 enums) | 1 file |
| Integration tests added | 4 (integration suite 4 -> 8) |
| Production/unit-test TS added | 0 (schema only) |
| Production JS/JSX deleted | 0 |

Backend authored JS/JSX backlog unchanged at **83 files**. Integration 8/8 vs
PostgreSQL 16 (unique-active partial index + reuse-after-rejection, phone-format
check, `digest()` consent SHA-256 check, one-pending-token index). First child
of BE-007; the `users`-dependent tables, RBAC/audit, outbox/email, repositories,
and bootstrap seed follow in later BE-007 children.

## Delta: BE-007b Canonical Identity/Invite Tables (branch `ts-migration/backend`)

Additive schema; deletes no JavaScript.

| Change | Value |
|---|---:|
| Migration SQL added (`010_canonical_identity.sql`: 4 tables, 3 enums, 1 FK) | 1 file |
| Integration tests added | 2 (integration suite 8 -> 10) |
| Production JS/JSX deleted | 0 |

Backend authored JS/JSX backlog unchanged at **83 files**. Integration 10/10 vs
PostgreSQL 16 (identity uniqueness, Argon2id hash-prefix + lock-window
credential invariants, one-review-per-application, one-pending-invite composite
ownership, verification-token user FK). Second child of BE-007.

## Delta: BE-007c Canonical Session Tables (branch `ts-migration/backend`)

Additive schema; deletes no JavaScript.

| Change | Value |
|---|---:|
| Migration SQL added (`011_canonical_sessions.sql`: 2 tables, 2 enums) | 1 file |
| Integration tests added | 1 (integration suite 10 -> 11) |
| Production JS/JSX deleted | 0 |

Backend authored JS/JSX backlog unchanged at **83 files**. Integration 11/11 vs
PostgreSQL 16 (one-active-native-session-per-device, native/web CSRF rules,
single-current refresh token, composite cascade FK; NULL-safe CHECK fixes).
Third child of BE-007.

## Delta: BE-007d Canonical RBAC/Audit/Platform Tables (branch `ts-migration/backend`)

Additive schema; deletes no JavaScript.

| Change | Value |
|---|---:|
| Migration SQL added (`012_canonical_rbac_platform.sql`: 9 tables, 2 enums) | 1 file |
| Integration tests added | 1 (integration suite 11 -> 12) |
| Production JS/JSX deleted | 0 |

Backend authored JS/JSX backlog unchanged at **83 files**. Integration 12/12 vs
PostgreSQL 16 (snake_case role codes + single active role-permission grant,
closed 8-code maker-checker set with maker<>checker, idempotency scope
uniqueness, positive rate-limit counts, legal-hold allowlist +
one-unreleased-per-entity; NULL-safe all-or-nothing groups). Fourth child of
BE-007.

## Delta: BE-007e Canonical Outbox/Email Delivery Tables (branch `ts-migration/backend`)

Additive schema; deletes no JavaScript.

| Change | Value |
|---|---:|
| Migration SQL added (`013_canonical_outbox_email.sql`: 4 tables, 2 enums) | 1 file |
| Integration tests added | 1 (integration suite 12 -> 13) |
| Production JS/JSX deleted | 0 |

Backend authored JS/JSX backlog unchanged at **83 files**. Integration 13/13 vs
PostgreSQL 16 (outbox dedup + transit-only all-or-null lease group,
template<->subject FK matrix, 32-byte recipient HMAC, all-or-null recipient/
failure/provider AES-256-GCM envelopes, unique SNS message id with valid-but-
unknown correlation still committing, suppression composite PK + lift group).
Fifth child of BE-007.

## Delta: BE-007f Kysely Schema Types + Repository Interfaces (branch `ts-migration/backend`)

Type foundation; deletes no JavaScript.

| Change | Value |
|---|---:|
| Source TS added/expanded (`types.ts` full `Database`, `repositories.ts` §7 contract, `limits.ts`) | 3 files |
| Tests added | `limits.test.ts` (unit) + 1 integration round-trip (unit 42 -> 43; integration 13 -> 14) |
| Production JS/JSX deleted | 0 |

Backend authored JS/JSX backlog unchanged at **83 files**. Typecheck resolves the
whole §7 contract (`Row<T>` for all 23 tables); integration 14/14 vs PostgreSQL 16
with a typed Kysely round-trip proving the schema types match the live DDL.
Coverage 87.88% (type-only files are 0-statement; numeric ceilings covered by a
unit test). Sixth child of BE-007.

## Delta: BE-007g Typed Idempotent Bootstrap Seed (branch `ts-migration/backend`) — closes BE-007

Additive bootstrap data + tooling; deletes no JavaScript.

| Change | Value |
|---|---:|
| Source TS added (`seedCatalog.ts`, `scripts/seed.ts`) | 2 files |
| Package scripts added (`seed`, `seed:dev`) | 2 |
| Tests added (`seedCatalog.test.ts`, `seed.test.ts` unit; 1 integration idempotency) | unit 45 -> 51; integration 14 -> 15 |
| Production JS/JSX deleted | 0 (legacy `seed-auth.js` deleted at BE-005) |

Backend authored JS/JSX backlog unchanged at **83 files**. Integration 15/15 vs
PostgreSQL 16 (catalog applied + idempotent on a second run; consent SHA-256
matches the pgcrypto CHECK). **BE-007 is DONE** (children a-g). Seventh child of
BE-007.

## Delta: BE-006 Fastify HTTP Boundary Primitives (branch `ts-migration/backend`)

Additive typed boundary; deletes no JavaScript (legacy `http/*.js` -> BE-019).

| Change | Value |
|---|---:|
| Source TS added (`errorCatalog`, `envelope`, `validation`, `idempotencyProtocol`, `boundary`) | 5 files |
| Source TS rewired (`runtime/application.ts`) | 1 file |
| Tests added/updated (5 boundary test files; `application.test.ts` to canonical envelope) | unit 51 -> 75 |
| Production JS/JSX deleted | 0 |

Backend authored JS/JSX backlog unchanged at **83 files**. New boundary modules
100% covered; integration unchanged (15/15). New modules named
`errorCatalog`/`idempotencyProtocol` to avoid a `.ts`<->`.js` basename collision
with the legacy `errors.js`/`idempotency.js` (resolved this batch).

## Delta: BE-008a Public Consent-Documents Route (branch `ts-migration/backend`)

First canonical `/v1` route; deletes no JavaScript yet.

| Change | Value |
|---|---:|
| Source TS added (`repositories/consentRepository.ts`, `routes/publicOnboardingRoutes.ts`) | 2 files |
| Integration tests added (`publicRoutes.integration.test.ts`) | 1 (integration 15 -> 16 across 2 files) |
| Production JS/JSX deleted | 0 |

Backend authored JS/JSX backlog unchanged at **83 files**. First real repository
implementation + route proven end-to-end on PostgreSQL 16. First child of BE-008.

## Delta: BE-008b-1 Onboarding Crypto Primitives (branch `ts-migration/backend`)

New `node:crypto` module; deletes no JavaScript yet.

| Change | Value |
|---|---:|
| Source TS added (`crypto/primitives.ts`, `crypto/context.ts`) | 2 files |
| Test TS added (`crypto/primitives.test.ts`, `crypto/context.test.ts`) | 2 files |
| Production JS/JSX deleted | 0 |

Backend authored JS/JSX backlog unchanged at **83 files**. AES-256-GCM envelope +
keyed HMAC + opaque-token primitives proven by unit tests (round-trip, tamper,
format, key length). Second child of BE-008 (BE-008b-1).

## Delta: BE-008b-2 Application Submission Route (branch `ts-migration/backend`)

New route + repositories + command; deletes no JavaScript yet (BE-008c).

| Change | Value |
|---|---:|
| Source TS added (6 repositories + `submitApplication`) | 7 files |
| Source TS modified (route, `idempotencyProtocol`, `crypto/primitives`, both vitest configs) | 5 files |
| Integration tests added | +5 (integration 16 -> 21) |
| Production JS/JSX deleted | 0 |

Backend authored JS/JSX backlog unchanged at **83 files**. `POST /v1/applications`
proven on PostgreSQL 16 (uniform 202, DB idempotency, atomic multi-table create).
Unit coverage now excludes `repositories/routes/domain`; the integration config
enforces its own 80% gate over them (measured 99.48% stmts / 85.24% branch).
Third child of BE-008 (BE-008b-2).

## Delta: BE-008c Verify-Email Route + First Onboarding JS Deletion (branch `ts-migration/backend`)

**First backend JavaScript deletion.**

| Change | Value |
|---|---:|
| Source TS added (`verifyApplicationEmail` + verify route + token repo methods) | 1 file + edits |
| Test added (verify integration + `legacy-deletion.guard.test.ts`) | integration 21 -> 24; +1 unit guard |
| **Production JS/JSX deleted (`onboardingService.js`)** | **1** |

Backend authored JS/JSX backlog **83 -> 82 files**. `POST /v1/applications/verify-email`
proven on PostgreSQL 16 (single-use token -> submitted; 409/410/400). Fourth child
of BE-008 (BE-008c). Reproduce: `find backend_controller/src backend_controller/scripts
-type f \( -name '*.js' -o -name '*.jsx' \) | wc -l` -> 82.

## Delta: BE-009a Argon2id Password Hasher (branch `ts-migration/backend`)

Security-core start; deletes legacy scrypt module.

| Change | Value |
|---|---:|
| Pinned deps added (`argon2@0.44.0`, `jose@6.2.3`) | 2 |
| Source TS added (`auth/passwordHasher.ts`) + test | 2 files |
| **Production JS/JSX deleted (`security/passwords.js`)** | **1** |

Backend authored JS/JSX backlog **82 -> 81 files**. Argon2id hashing proven in
source + emitted dist. First child of BE-009 (BE-009a).

## Delta: BE-009b Breached-Password Check (branch `ts-migration/backend`)

Additive security capability; deletes no JavaScript.

| Change | Value |
|---|---:|
| Source TS added (`auth/breachCheck.ts`) + test | 2 files |
| Production JS/JSX deleted | 0 |

Backend authored JS/JSX backlog unchanged at **81 files**. HIBP k-anonymity
checker proven offline (breached/padding/cache/fail-closed/bypass). Second child
of BE-009 (BE-009b).

## Delta: BE-009c ES256 Access-Token Service (branch `ts-migration/backend`)

Additive; deletes no JavaScript.

| Change | Value |
|---|---:|
| Source TS added (`auth/accessToken.ts`) + test | 2 files |
| Production JS/JSX deleted | 0 |

Backend authored JS/JSX backlog unchanged at **81 files**. ES256 sign/verify with
kid selection proven (round-trip + unknown-kid/wrong-audience/tampered rejects).
Third child of BE-009 (BE-009c).

## Delta: BE-009d Refresh/CSRF Session-Token Primitives (branch `ts-migration/backend`) — closes BE-009

Deletes the legacy HS256 token module.

| Change | Value |
|---|---:|
| Source TS added (`auth/sessionTokens.ts`) + test | 2 files |
| **Production JS/JSX deleted (`security/tokens.js`)** | **1** |

Backend authored JS/JSX backlog **81 -> 80 files**. Opaque refresh/CSRF tokens
with keyed hashing + constant-time verify proven. **BE-009 DONE (a-d)**; 3 of the
security core's files gone (passwords + tokens; `auth.js` -> BE-010). Fourth
child of BE-009 (BE-009d).

## Delta: BE-010a Auth Session + Credential Repositories (branch `ts-migration/backend`)

Additive native-session DB layer; deletes no JavaScript.

| Change | Value |
|---|---:|
| Source TS added (`credentialRepository.ts`, `authSessionRepository.ts`) | 2 files |
| Integration test added (`authRepositories.integration.test.ts`) | 1 file |
| Production JS/JSX deleted | 0 |

Backend authored JS/JSX backlog unchanged at **80 files**. Native session/refresh
create + lookup + revoke proven on PostgreSQL 16. First child of BE-010 (BE-010a).

## Delta: BE-010 native auth core (branch `ts-migration/backend`)

Accelerated single-task mode; additive (deletion pending full auth replacement).

| Change | Value |
|---|---:|
| Dep added (`libphonenumber-js@1.13.8`) | 1 |
| Source TS added (`refreshDerivation`, `phone`, `userRepository`, `activationInviteRepository`, `nativeAuth`, `nativeAuthRoutes`) + extended `authSessionRepository` | 6 + 1 |
| Critical integration test added (`authNative.integration.test.ts`) | 1 file / 4 tests |
| Production JS/JSX deleted | 0 (legacy auth trio deleted once web+refresh land) |

Backend authored JS/JSX unchanged at **80**. Integration 31/31 across 4 container
files; coverage 97.56% stmts / 86.2% branch over repositories/routes/domain.

## Delta: BE-010 web auth + legacy deletion (branch `ts-migration/backend`)

Completes the BE-010 auth surface and removes the legacy auth trio.

| Change | Value |
|---|---:|
| Source TS added (`webAuth.ts`, `webAuthRoutes.ts`) + extended `authSessionRepository` (web create/rotate) | 2 + 1 |
| Critical integration test added (`authWeb.integration.test.ts`) | 1 file / 3 tests |
| **Production JS/JSX deleted (`security/auth.js`, `authService.js`, `authService.signup.test.js`, `authRoutes.js`)** | **4** |

Backend authored JS/JSX **80 -> 76 files**. Integration 35/35 across 5 container
files; global coverage 96.81% stmts / 81.89% branch. BE-010 auth surface (native
+ web) complete; production wiring + `/csrf` recovery deferred.


## Delta: BE-011 Readiness/Compatibility Health (branch `ts-migration/backend`)

Adds canonical health/readiness; deletes the legacy leaky health surface.

| Change | Value |
|---|---:|
| Source TS added (`runtime/health.ts`) + unit test (`runtime/health.test.ts`) | 2 files |
| **Production JS/JSX deleted (`shared/services/healthService.js`, `shared/routes/healthRoutes.js`)** | **2** |

Backend authored JS/JSX backlog **76 -> 74 files**. `/health/ready` (200/503
plain, no value leaks; degraded until DB reachable + emailConfigured) and
`/v1/health` (success envelope); `/health/live` unchanged. `npm run check` green;
integration 35/35 (unaffected). Reproduce: `find backend_controller/src
backend_controller/scripts -type f \( -name '*.js' -o -name '*.jsx' \) | wc -l`
-> 74.


## Delta: BE-012 SES/SNS Outbox Delivery Worker (branch `ts-migration/backend`)

Adds the canonical email outbox worker + signed SNS provider-event ingress. This
batch is purely additive redesign infrastructure (the legacy app had no SES/SNS
worker), so it deletes no legacy JS.

| Change | Value |
|---|---:|
| Pure TS added (`src/email/{ports,retrySchedule,snsMessages,snsProvenance}.ts`) + 3 unit tests | 7 files |
| Repositories added (`emailProviderEventRepository`, `emailSuppressionRepository`) + 2 extended (`outboxRepository`, `emailDeliveryRepository`) | 4 files |
| Domain added (`dispatchDueDeliveries`, `recordProviderEvent`) + route (`providerEventRoutes`) | 3 files |
| Integration test (`emailDelivery.integration.test.ts`, 8 tests) | 1 file |
| **Production JS/JSX deleted** | **0** |

Backend authored JS/JSX backlog **stays 74 files** (unchanged — additive batch).
Unit tests 57 new (email); integration 35 -> 43 (+8). `npm run check` green; full
integration aggregate 96.2% stmts / 80.75% branch over repositories/routes/domain.
`package.json`/`package-lock.json` unchanged (test cert fixture minted then tool
removed). Concrete AWS SES/cert-fetch adapters deferred to production wiring.
Reproduce JS count: `find backend_controller/src backend_controller/scripts -type f
\( -name '*.js' -o -name '*.jsx' \) | wc -l` -> 74.


## Delta: BE-013 Retire Legacy Public Content/Catalog (branch `ts-migration/backend`)

Spec-faithful deletion batch. Spec 04 declares the first-slice route inventory
exhaustive and defers courses/plans/FAQs/general content/disclosures/financial
routes to later slices; the only first-slice public content route is
`GET /v1/public/consent-documents` (already served by `publicOnboardingRoutes.ts`).
No new schema/routes were added.

| Change | Value |
|---|---:|
| **Production JS/JSX deleted (`website/routes/publicRoutes.js`, `website/services/disclosureService.js`)** | **2** |
| New TS/schema added | 0 |

Backend authored JS/JSX backlog **74 -> 72 files**. Both deleted files were already
dead (publicRoutes imported only by dead `router.js` and imported the deleted
`onboardingService.js`; disclosureService imported only by publicRoutes). `npm run
check` green; integration 43/43 (unaffected). Canonical content/catalog + schema
deferred to a later slice (GATE-07). Reproduce: `find backend_controller/src
backend_controller/scripts -type f \( -name '*.js' -o -name '*.jsx' \) | wc -l` -> 72.


## Delta: BE-014 Retire Legacy Payment/Mandate Webhooks + Providers (branch `ts-migration/backend`)

Spec-faithful deletion batch. Spec 04's only first-slice webhook is
`POST /v1/provider-events/aws-sns` (SES/SNS email, BE-012); payment/mandate provider
webhooks and the wider financial domain are deferred to later slices, and the legacy
code ran on the retired JSON store + non-canonical tables. No new schema/routes.

| Change | Value |
|---|---:|
| **Production JS/JSX deleted (`webhookRoutes.js`, `webhookService.js`, `payments/{mockProvider,providerFactory,razorpayProvider}.js`)** | **5** |
| New TS/schema added | 0 |

Backend authored JS/JSX backlog **72 -> 67 files**. All five were dead (no TS
consumers; `providerFactory` still imported only by legacy `orderService`/`sipService`
[BE-015] + `reconcileService` [BE-017], which are dead JS outside the TS build graph).
`npm run check` green; integration 43/43 (unaffected). Canonical payments/provider
design deferred to a later slice (GATE-08). Reproduce: `find backend_controller/src
backend_controller/scripts -type f \( -name '*.js' -o -name '*.jsx' \) | wc -l` -> 67.


## Delta: BE-015 Retire Legacy Client Investment Domain (branch `ts-migration/backend`)

Spec-faithful deletion batch. Every `/v1/client/*` route is financial and absent
from spec 04's exhaustive first-slice inventory; the services ran on the retired
JSON store. The first-slice client surface is native/web auth (BE-010). No new
schema/routes.

| Change | Value |
|---|---:|
| **Production JS/JSX deleted (`client/routes/clientRoutes.js` + 15 `client/services/*.js`)** | **16** |
| New TS/schema added | 0 |

Backend authored JS/JSX backlog **67 -> 51 files** (`src/client/` removed). All dead
(no TS consumers; no non-client importer). `npm run check` green; integration 43/43
(unaffected). Canonical client finance domain + schema deferred to a later slice
(GATE-08). Reproduce: `find backend_controller/src backend_controller/scripts -type f
\( -name '*.js' -o -name '*.jsx' \) | wc -l` -> 51.


## Delta: BE-016 Canonical Admin Identity/Compliance Domain (branch `ts-migration/backend`)

First non-deletion domain batch since BE-012: builds the first-slice admin
identity surface (spec §3.2/§4.5) in TypeScript. Additive — no legacy JS deleted
(the admin JS block, imported only by BE-017's `adminRoutes.js`, is retired in
BE-017).

| Change | Value |
|---|---:|
| Source TS added (`http/cursor.ts`, `domain/admin/*` [adminAccess + 3 commands], `applicationReviewRepository.ts`, `routes/adminIdentityRoutes.ts`) | 7 files |
| Source TS extended (`envelope.ts`, `boundary.ts`, `applicationRepository.ts`, `userRepository.ts`, `activationInviteRepository.ts`, `emailDeliveryRepository.ts`) | 6 files |
| Tests added (`http/cursor.test.ts` unit + `adminIdentity.integration.test.ts` 20 tests) | 2 files |
| **Production JS/JSX deleted** | **0** |

Backend authored JS/JSX backlog **stays 51 files** (additive). Integration 43 -> 63
(+20). `npm run check` green; full integration aggregate ≥80% branch over
repositories/routes/domain. `package.json`/`package-lock.json` unchanged. Admin
legacy retirement deferred to BE-017. Reproduce JS count: `find backend_controller/src
backend_controller/scripts -type f \( -name '*.js' -o -name '*.jsx' \) | wc -l` -> 51.


## Delta: BE-017 Retire Legacy Admin Finance/Content Domain (branch `ts-migration/backend`)

Spec-faithful deletion batch. Every `/v1/admin/*` finance/content/compliance route
is deferred to later slices per spec 04; the services ran on the retired JSON store.
The first-slice admin identity surface is served by `adminIdentityRoutes.ts`
(BE-016). No new schema/routes.

| Change | Value |
|---|---:|
| **Production JS/JSX deleted (`admin/routes/adminRoutes.js` + 11 `admin/services/*.js`)** | **12** |
| New TS/schema added | 0 |

Backend authored JS/JSX backlog **51 -> 39 files** (`src/admin/` removed). All dead
(no TS consumers). `npm run check` green; integration 63/63 (unaffected). Canonical
admin finance/content deferred to a later slice (GATE-08). Reproduce: `find
backend_controller/src backend_controller/scripts -type f \( -name '*.js' -o -name
'*.jsx' \) | wc -l` -> 39.


## Delta: BE-018 Retire Remaining Legacy Shared Block (branch `ts-migration/backend`)

Spec-faithful deletion batch. The remaining `src/shared/**` legacy JS served
deferred content/financial domains on the retired JSON store with no TS consumers;
the canonical first-slice surface lives in `src/routes/*.ts` + `src/runtime`.

| Change | Value |
|---|---:|
| **Production JS/JSX deleted (`src/shared/**` config/contracts/routes/services/utils)** | **26** |
| New TS/schema added | 0 |

Backend authored JS/JSX backlog **39 -> 13 files** (`src/shared/` removed). All dead
(no TS consumers). `npm run check` green; integration 63/63 (unaffected). Remaining
13 = legacy transport (`http/*.js` x5, `router.js`), persistence
(`db/{client,pgAdapter,store}.js` x3), and legacy `scripts/*.js` x4 -> BE-019, then
BE-020 zero-JS gate. Reproduce: `find backend_controller/src backend_controller/scripts
-type f \( -name '*.js' -o -name '*.jsx' \) | wc -l` -> 13.

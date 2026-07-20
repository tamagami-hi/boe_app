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

## Completed Slice: ES256 Access-Token Service (BE-009c)

**Status:** Complete (branch `ts-migration/backend`, PR #1 to `main`). Third child
of BE-009. Additive.

**Scope:** `src/auth/accessToken.ts` — ES256-only `jose` sign/verify with
versioned `kid`, pinned iss/aud/`typ=access`/<=30s skew, 10-min TTL.

| Gate | Status | Evidence |
|---|---|---|
| Sign/verify round-trip | Complete | unit: sub/sid/jti/kid returned |
| kid + audience pinning | Complete | unit: unknown kid + wrong audience reject |
| Tamper/malformed | Complete | unit: both reject with AUTHENTICATION_REQUIRED |
| Unit + integration | Complete | `npm run check` green (jose in dist smoke); integration 24/24 |
| Commit/push | Complete | Committed on `ts-migration/backend`; PR #1 updated |

## Completed Slice: Breached-Password Check (BE-009b)

**Status:** Complete (branch `ts-migration/backend`, PR #1 to `main`). Second
child of BE-009. Additive (no deletion).

**Scope:** `src/auth/breachCheck.ts` — HIBP k-anonymity checker with an
injectable `fetch`, 2s timeout, 24h prefix cache, constant-time suffix compare,
fail-closed DEPENDENCY_UNAVAILABLE, and test/dev-only bypass.

| Gate | Status | Evidence |
|---|---|---|
| Breached rejection | Complete | unit: count>0 -> VALIDATION_FAILED |
| Padding tolerated | Complete | unit: count 0 suffix resolves |
| Fail-closed | Complete | unit: non-2xx + reject -> DEPENDENCY_UNAVAILABLE |
| Cache + bypass + mode | Complete | unit: one request per prefix; bypass no-op; prod+bypass rejected |
| Unit + integration | Complete | `npm run check` green; integration 24/24 |
| Commit/push | Complete | Committed on `ts-migration/backend`; PR #1 updated |

## Completed Slice: Argon2id Password Hasher (BE-009a)

**Status:** Complete (branch `ts-migration/backend`, PR #1 to `main`). First child
of BE-009 (security core).

**Scope:** `src/auth/passwordHasher.ts` (Argon2id hash/verify + timing-safe dummy
verify + `PasswordInput`) on the pinned native `argon2@0.44.0`; `jose@6.2.3`
pinned for BE-009c. Deletes `src/security/passwords.js`.

**Explicitly deferred:** breach check (BE-009b), ES256 access tokens (BE-009c),
refresh/CSRF rotation (BE-009d), auth routes (BE-010); legacy
`security/{auth,tokens}.js` deleted as those land.

| Gate | Status | Evidence |
|---|---|---|
| Argon2id hash/verify | Complete | unit: `$argon2id$` prefix; verify true/false |
| PasswordInput | Complete | unit: rejects short + control; accepts valid |
| Native dep in dist | Complete | build + `smoke:dist` load argon2 prebuilt |
| **JS deletion** | **Complete** | **`security/passwords.js` removed; backend JS 82 -> 81** |
| Unit + integration | Complete | `npm run check` green; integration 24/24 |
| Commit/push | Complete | Committed on `ts-migration/backend`; PR #1 updated |

## Completed Slice: Verify-Email Route + First Onboarding JS Deletion (BE-008c)

**Status:** Complete (branch `ts-migration/backend`, PR #1 to `main`). Fourth
child of BE-008; the **first backend JavaScript deletion**.

**Scope:** `POST /v1/applications/verify-email` (`verifyApplicationEmail` command
+ `verificationTokenRepository.lockByHash`/`consume` +
`applicationRepository.markEmailVerified`), and deletion of
`src/website/services/onboardingService.js` guarded by
`legacy-deletion.guard.test.ts`.

**Explicitly deferred:** cooldown resend + cross-match + race savepoint
(BE-008b-3); the `publicRoutes.js` monolith (BE-013).

| Gate | Status | Evidence |
|---|---|---|
| Single-use verification | Complete | integration: valid -> 200 submitted; replay -> 409 TOKEN_ALREADY_USED |
| Token error mapping | Complete | integration: unknown -> 400 TOKEN_INVALID; expired -> 410 TOKEN_EXPIRED |
| Atomic transition | Complete | consume + `submitted` + `email_verified_at` + audit in one tx |
| Deletion safety | Complete | no TS consumer; legacy graph has no entrypoint; guard test asserts absence |
| **JS deletion** | **Complete** | **`onboardingService.js` removed; backend JS 83 -> 82** |
| Unit + integration | Complete | `npm run check` green; integration 24/24 (99.58% stmts) |
| Commit/push | Complete | Committed on `ts-migration/backend`; PR #1 updated |

## Completed Slice: Application Submission Route (BE-008b-2)

**Status:** Complete (branch `ts-migration/backend`, PR #1 to `main`). Third child
of BE-008 (`POST /v1/applications`), building on BE-008b-1 crypto.

**Scope:** 7 repository implementations (application/consent/verification-token/
outbox/email-delivery/audit/idempotency), the `submitApplication` command, the
route with database-backed idempotency, and the corrected `executeIdempotent`.

**Explicitly deferred:** cooldown resend + cross-match metric + concurrent-race
savepoint (BE-008b-3); verify-email + `onboardingService.js` deletion (BE-008c);
SES sending + transient-token hardening (BE-012).

| Gate | Status | Evidence |
|---|---|---|
| New submission atomic | Complete | integration: 1 application + 2 consents + 1 token + 1 queued delivery + 1 outbox + 1 audit |
| Uniform response | Complete | integration: new and duplicate both return 202 `{accepted:true}` |
| DB idempotency | Complete | integration: repeated key replays (no new rows); missing key -> 400 |
| Consent authority | Complete | integration: stale consent version -> 400; documents resolved from the table |
| Coverage | Complete | unit gate excludes repositories/routes/domain; integration gate 99.48% stmts / 85.24% branch |
| JS deletion | N/A | deferred to BE-008c |
| Commit/push | Complete | Committed on `ts-migration/backend`; PR #1 updated |

## Completed Slice: Public Consent-Documents Route (BE-008a)

**Status:** Complete (branch `ts-migration/backend`, PR #1 to `main`). First
child of BE-008; the first canonical `/v1` route end-to-end.

**Scope:** `src/repositories/consentRepository.ts` (`findCurrentDocuments`) and
`src/routes/publicOnboardingRoutes.ts` (`GET /v1/public/consent-documents`),
composed into `createApplication` and proven on PostgreSQL 16.

**Explicitly deferred:** `POST /v1/applications` (BE-008b); verify-email +
deletion of `website/services/onboardingService.js` (BE-008c); the rest of
`ConsentRepository` (BE-008b).

| Gate | Status | Evidence |
|---|---|---|
| Route returns authoritative docs | Complete | integration: seeded terms/privacy returned with matching SHA-256 (16/16) |
| One current doc per kind | Complete | query filters `retired_at IS NULL`; partial unique index enforces |
| Envelope | Complete | `reply.sendData` success envelope via the BE-006 boundary |
| Unit check | Complete | `npm run check` green |
| JS deletion | N/A | deferred to BE-008c |
| Commit/push | Complete | Committed on `ts-migration/backend`; PR #1 updated |

## Completed Slice: Fastify HTTP Boundary Primitives (BE-006)

**Status:** Complete (branch `ts-migration/backend`, PR #1 to `main`). The typed
HTTP boundary every `/v1` route batch consumes.

**Scope:** `src/http/{errorCatalog,envelope,validation,idempotencyProtocol,boundary}.ts`
wired into `createApplication` — request-id resolution, canonical
`{ok,data,error,meta}` envelope (`reply.sendData`), stable `ErrorCode` catalog +
internal->public mapping + `AppError`, `MAX_JSON_BODY_BYTES=65536` (413) +
media-type (415), Zod `parseOrThrow`, and the pure `executeIdempotent`
orchestrator over `IdempotencyRepository`.

**Explicitly deferred:** legacy `src/http/*.js` + `router.js` deletion (BE-019);
SNS raw-body route + signature (BE-012/BE-014); cookie/CSRF/auth guards
(BE-009/BE-010); idempotency repository impl + transaction wiring (BE-008).

| Gate | Status | Evidence |
|---|---|---|
| Envelope + request id | Complete | inject: 200 `sendData` envelope; valid `X-Request-Id` echoed, invalid replaced |
| Stable error mapping | Complete | unit: every code has status/retryable/message; internal->public map; inject 404/409 |
| Body/media limits | Complete | inject: 413 PAYLOAD_TOO_LARGE (>65536), 415 UNSUPPORTED_MEDIA_TYPE |
| No internal leakage | Complete | inject: 500 redacted, no secret path/query/header/provider text; logs redacted |
| Idempotency protocol | Complete | unit: lock-win/replay/reused/in-progress over a fake repository |
| Unit check | Complete | `npm run check` green; boundary modules 100% |
| JS deletion | N/A | additive; legacy transport deleted at BE-019 |
| Commit/push | Complete | Committed on `ts-migration/backend`; PR #1 updated |

## Completed Slice: Typed Idempotent Bootstrap Seed (BE-007g) — closes BE-007

**Status:** Complete (branch `ts-migration/backend`, PR #1 to `main`). Seventh
and final child packet of BE-007; **BE-007 is now DONE**.

**Scope:** `src/db/seedCatalog.ts` (authoritative role/permission catalog +
role->permission map + current consent documents + `buildSeedStatements()`) and
`src/scripts/seed.ts` (transactional runner + CLI; `seed`/`seed:dev` scripts).

**Explicitly deferred:** `role_permissions`/`user_roles` grants and the optional
admin user + Argon2id credential + redacted audit event (the security bootstrap
transaction — needs a granting user) land with BE-009/BE-016 per spec 02 §3.5.

| Gate | Status | Evidence |
|---|---|---|
| Catalog validity | Complete | unit: snake_case roles, single-dot permission codes, superadmin holds all, mappings reference known rows |
| Idempotency | Complete | integration: `runSeed` twice leaves role/permission/consent counts unchanged; every statement `ON CONFLICT DO NOTHING` |
| Consent digest correctness | Complete | TS SHA-256 equals pgcrypto `digest(...,'sha256')` CHECK — 15/15 integration |
| No compiled admin secret | Complete | seed contains catalog rows only (spec 02 §3.5) |
| Unit check | Complete | `npm run check` green (seedCatalog.ts 100%, seed.ts 75% CLI-only) |
| JS deletion | N/A | legacy `seed-auth.js` already deleted at BE-005 |
| Commit/push | Complete | Committed on `ts-migration/backend`; PR #1 updated |

## Completed Slice: Kysely Schema Types + Repository Interfaces (BE-007f)

**Status:** Complete (branch `ts-migration/backend`, PR #1 to `main`). Sixth
child packet of BE-007 (parent remains in progress). Type foundation.

**Scope:** `src/db/types.ts` now defines the full canonical `Database` map (23
first-slice tables mirroring migrations `009`-`013`); `src/db/repositories.ts`
transcribes spec §7 as the type-only repository interface contract; and
`src/db/limits.ts` (+ unit test) pins the §7 numeric ceilings.

**Explicitly deferred:** repository *implementations* land with their consuming
command/route batches (BE-008+) where they get behavioral integration tests
(matches the spec note that later slices add focused repositories). Later-domain
repositories (Kyc/Fund/Order/Payment/...) land with §4 schema (BE-016+).
Bootstrap seed -> BE-007g.

| Gate | Status | Evidence |
|---|---|---|
| Schema types compile | Complete | `npm run typecheck` green; `Row<T>`/`Selectable<Database[T]>` resolve for all 23 tables |
| Types match live DDL | Complete | typed Kysely round-trip on `applications`/`roles`/`outbox_events` (defaulted enum, bigint-as-string, jsonb-object, timestamptz-as-Date) — 14/14 integration |
| Coverage-safe | Complete | type-only files are 0-statement; numeric limits covered by `limits.test.ts`; aggregate 87.88% |
| Unit check | Complete | `npm run check` green (43 unit tests) |
| Review | Complete | Focused inline review; secrets typed opaque; branded ids; no CRITICAL/HIGH/MEDIUM |
| JS deletion | N/A | Type foundation; onboarding JS deleted starting BE-008 |
| Commit/push | Complete | Committed on `ts-migration/backend`; PR #1 updated |

## Completed Slice: Canonical Outbox/Email Delivery Tables (BE-007e)

**Status:** Complete (branch `ts-migration/backend`, PR #1 to `main`). Fifth
child packet of BE-007 (parent remains in progress).

**Scope:** Additive migration `db/migrations/013_canonical_outbox_email.sql`
adds enums `outbox_state`/`email_delivery_state` and the tables `outbox_events`,
`email_deliveries`, `email_provider_events`, `email_suppressions` with their
§3.3 constraints. Proven on PostgreSQL 16.

**Explicitly deferred to later BE-007 children / other tasks:** the Kysely
repositories (BE-007f) and the typed bootstrap seed (BE-007g). The worker
claim/lease state machine, exponential-backoff schedule, AES-256-GCM envelope
encryption, and SNS signature validation are command/worker-enforced.

| Gate | Status | Evidence |
|---|---|---|
| Migration applies on empty PG (`>= 009`) | Complete | BE-005 runner applies 009-013 |
| Constraints verified | Complete | outbox dedup + transit-only lease group, template<->subject FK matrix, 32-byte recipient HMAC, all-or-null PII envelope, unique SNS id with unmatched-correlation commit, suppression PK + lift group — 13/13 integration |
| NULL-safe CHECK correctness | Complete | envelope/lease/lift groups written as explicit all-null-or-all-present disjunctions |
| Unit check | Complete | `npm run check` green (coverage 87.69%) |
| Review | Complete | Focused inline review; additive; no CRITICAL/HIGH/MEDIUM |
| JS deletion | N/A | Additive; outbox/email service JS deleted by a later route/worker task |
| Commit/push | Complete | Committed on `ts-migration/backend`; PR #1 updated |

## Completed Slice: Canonical RBAC/Audit/Platform Tables (BE-007d)

**Status:** Complete (branch `ts-migration/backend`, PR #1 to `main`). Fourth
child packet of BE-007 (parent remains in progress).

**Scope:** Additive migration `db/migrations/012_canonical_rbac_platform.sql`
adds enums `approval_state`/`actor_type` and the tables `roles`, `permissions`,
`role_permissions`, `user_roles`, `approval_actions`, `audit_events`,
`idempotency_records`, `rate_limit_windows`, `legal_holds` with their §3.3
constraints. Proven on PostgreSQL 16.

**Explicitly deferred to later BE-007 children:** outbox/email (BE-007e), the
Kysely repositories (BE-007f), and the typed bootstrap seed (BE-007g). Append-
only enforcement triggers and app-role grant hardening are a later step.

| Gate | Status | Evidence |
|---|---|---|
| Migration applies on empty PG (`>= 009`) | Complete | BE-005 runner applies 009+010+011+012 |
| Constraints verified | Complete | snake_case role codes + single active grant, closed maker-checker set with maker<>checker, idempotency scope uniqueness, rate-limit count>0, legal-hold allowlist + one-unreleased — 12/12 integration |
| NULL-safe CHECK correctness | Complete | all-or-nothing revoke/release groups + actor-user rule use explicit `IS NULL`/`IS NOT NULL` guards |
| Unit check | Complete | `npm run check` green |
| Review | Complete | Focused inline review; additive; no CRITICAL/HIGH/MEDIUM |
| JS deletion | N/A | Additive; RBAC/audit service JS deleted by BE-010/BE-012/BE-016 |
| Commit/push | Complete | Committed on `ts-migration/backend`; PR #1 updated |

## Completed Slice: Canonical Session Tables (BE-007c)

**Status:** Complete (branch `ts-migration/backend`, PR #1 to `main`). Third
child packet of BE-007 (parent remains in progress).

**Scope:** Additive migration `db/migrations/011_canonical_sessions.sql` adds
enums `session_channel`/`auth_session_state` and tables `auth_sessions`,
`auth_refresh_tokens` with their §3.2 constraints. Proven on PostgreSQL 16.

**Explicitly deferred to later BE-007 children:** RBAC/audit/idempotency/
rate-limit/legal-hold (BE-007d), outbox/email (BE-007e), the Kysely repositories
(BE-007f), and the typed bootstrap seed (BE-007g).

| Gate | Status | Evidence |
|---|---|---|
| Migration applies on empty PG (`>= 009`) | Complete | BE-005 runner applies 009+010+011 |
| Constraints verified | Complete | one-active-native-session/device, native/web CSRF rules, single-current refresh token, cascade FK — 11/11 integration |
| NULL-safe CHECK correctness | Complete | web-requires-CSRF and all-or-nothing pairs rewritten with `IS NOT NULL` guards |
| Unit check | Complete | `npm run check` green (42 tests) |
| Review | Complete | Focused inline review; additive; no CRITICAL/HIGH/MEDIUM |
| JS deletion | N/A | Additive; auth service JS deleted by BE-009/BE-010 |
| Commit/push | Complete | Committed on `ts-migration/backend`; PR #1 updated |

## Completed Slice: Canonical Identity/Invite Tables (BE-007b)

**Status:** Complete (branch `ts-migration/backend`, PR #1 to `main`). Second
child packet of BE-007 (parent remains in progress).

**Scope:** Additive migration `db/migrations/010_canonical_identity.sql` adds the
enums `user_account_state`/`activation_invite_state`/`application_decision` and
the tables `users`, `user_credentials`, `application_reviews`,
`activation_invites`, and attaches the deferred
`verification_tokens.user_id -> users(id)` FK. Proven on PostgreSQL 16.

**Explicitly deferred to later BE-007 children:** `auth_sessions` +
`auth_refresh_tokens` (BE-007c), RBAC/audit/idempotency/rate-limit/legal-hold,
outbox/email, the Kysely repositories, and the typed bootstrap seed.

| Gate | Status | Evidence |
|---|---|---|
| Migration applies on empty PG (`>= 009` isolated) | Complete | BE-005 runner applies 009+010 in the harness |
| Constraints verified | Complete | identity uniqueness, Argon2id hash-prefix + lock-window, one review/app, one pending invite, verification-token user FK — 10/10 integration |
| Unit check | Complete | `npm run check` green (42 tests) |
| Review | Complete | Focused inline review; additive; no CRITICAL/HIGH/MEDIUM |
| JS deletion | N/A | Additive; identity/auth service JS deleted by BE-009/BE-010 |
| Commit/push | Complete | Committed on `ts-migration/backend`; PR #1 updated |

**Decision:** legacy `users` name-collision on a mixed `migrate up` recorded in
RISKS_AND_DECISIONS; canonical migrations run in isolation; legacy archived at
CLEAN-002.

## Completed Slice: Canonical Public-Onboarding Schema (BE-007a)

**Status:** Complete (branch `ts-migration/backend`, PR #1 to `main`). First
child packet of BE-007 (parent remains in progress).

**Scope:** Additive migration `db/migrations/009_canonical_onboarding.sql` adds
the enums `application_state`/`token_purpose` and the public-onboarding tables
`applications`, `consent_documents`, `application_consents`,
`verification_tokens` with their §3.1 constraints and partial-unique indexes,
proven on empty PostgreSQL 16 via the BE-005 migration runner.

**Explicitly deferred to later BE-007 children:** the `users`-dependent tables
(users/credentials/invites/sessions/refresh-tokens/reviews and the
`verification_tokens.user_id` FK), RBAC/audit/idempotency/rate-limit/legal-hold,
outbox/email, the Kysely repositories, and the typed bootstrap seed.

| Gate | Status | Evidence |
|---|---|---|
| No legacy collision | Complete | grep confirmed the 4 table names are new |
| Migration applies on empty PG | Complete | BE-005 runner applies `009` in the integration harness |
| Constraints verified | Complete | unique-active + reuse-after-rejection, phone format, consent SHA-256 digest, one-pending token — 8/8 integration |
| Unit check | Complete | `npm run check` green (42 tests) |
| Review | Complete | Focused inline review; additive; no CRITICAL/HIGH/MEDIUM |
| JS deletion | N/A | Additive; onboarding service JS deleted by BE-008 |
| Commit/push | Complete | Committed on `ts-migration/backend`; PR #1 updated |

**Honest note:** a strict RED-first run was not separately captured for this
schema increment (migration + assertions authored together, GREEN on first run);
recorded in the log.

## Completed Slice: Migration/Check Tooling (BE-005)

**Status:** Complete (branch `ts-migration/backend`, PR #1 to `main`). Third
backend JS deletion of the program.

**Scope:** Replace the legacy `psql`/alias-based operational scripts with emitted
TypeScript commands over the BE-004 typed pool — `src/scripts/migrate.ts`
(ordered, checksummed, per-migration transactional, idempotent apply tracked in
`schema_migrations`; `status|up` CLI) and `src/scripts/check-db.ts`. Deleted
`scripts/migrate.js`, `check-db.js`, `seed-auth.js`.

**Explicitly out of scope:** the typed bootstrap seed (needs canonical identity
tables; authored in BE-007) and the whole-store `pgAdapter.js`/`store.js`/
`client.js` (deleted at consumer cutover).

| Gate | Status | Evidence |
|---|---|---|
| Unit tests | Complete | 42/42; overall 87.69%/92.18%/90.9% (fake-pool covers runner logic) |
| RED before deletion | Complete | runtime-boundary deletion assertion failed while the JS existed |
| GREEN | Complete | 3 JS deleted; `npm run check` green; backend JS 86 -> 83 |
| Integration | Complete | 4/4 vs PostgreSQL 16, incl. idempotent migrate + `schema_migrations` record |
| Review | Complete | Focused inline review: transactional apply/rollback, parameterized bookkeeping, trusted-file SQL, no secret logging; no CRITICAL/HIGH/MEDIUM |
| Commit/push | Complete | Committed on `ts-migration/backend`; PR #1 updated |

## Completed Slice: PostgreSQL/Kysely Foundation (BE-004)

**Status:** Complete (branch `ts-migration/backend`, PR #1 to `main`). Phase 3
keystone; authorized ahead of full GATE-02 closure (deviation recorded) to
unblock the deletion-heavy persistence/identity/route batches.

**Scope:** Typed owned `pg` pool, typed Kysely instance, explicit
transaction/unit-of-work boundary, Zod DB config, and an (initially empty)
`Database` type — proven against real PostgreSQL 16 via Testcontainers.

**Explicitly out of scope:** the canonical schema/tables and repositories
(BE-007+), and deletion of legacy DB JS (BE-005 scripts + final cutover).

| Gate | Status | Evidence |
|---|---|---|
| Feasibility (Testcontainers over podman) | Complete | Spike started PostgreSQL 16 with a log-based wait + ryuk disabled |
| Unit tests | Complete | 34/34; coverage >=80% (src/db 95%/100%/83%) |
| Integration | Complete | 3/3 vs PostgreSQL 16: pooled query, committed transaction, full rollback |
| Typecheck/lint/build/smoke | Complete | `npm run check` green |
| Review | Complete | Focused inline review: explicit transactions, owned lazy pool, safe process-spawning wrapper, denied native install scripts; no CRITICAL/HIGH/MEDIUM |
| JS deletion | N/A | Additive; backlog stays 86 (BE-005 deletes DB scripts next) |
| Commit/push | Complete | Committed on `ts-migration/backend`; PR #1 updated |

**Decisions:** framework DB plugin rejected (backend owns pool/tx/shutdown);
`Database` empty until BE-007; container-runtime wrapper provisions podman for
the socket-less sandbox while real CI uses its Docker socket unchanged.

## Completed Slice: Runtime Configuration Closure (BE-003)

**Status:** Complete (branch `ts-migration/backend`, PR #1 to `main`). First
backend JavaScript deletion of the program.

**Scope:** Retire the superseded legacy config/logger JavaScript now that the
typed `runtime/environment.ts` + `runtime/logger.ts` boundary (BE-001) and Node
`--env-file-if-exists` are authoritative. Deleted `src/config/env.js`,
`src/config/dotenv.js`, `src/shared/logger.js`; added a runtime-boundary
deletion guard.

**Explicitly out of scope (deferred to owning batches):** typed secret/DB/CORS/
keyring configuration and its production startup validation (BE-004 DB, BE-006
HTTP/CORS, BE-009 security) — the liveness runtime has no such surface yet.

| Gate | Status | Evidence |
|---|---|---|
| Import-graph safety | Complete | No `src/**/*.ts` imports the removed files; legacy `#config`/`#shared` alias graph already removed in BE-001 |
| RED before deletion | Complete | runtime-boundary deletion assertion failed while files existed (1 failed / 3 passed) |
| GREEN | Complete | Files deleted; `npm run check` green; backend JS 89 -> 86 |
| Review | Complete | Focused inline review (dead-code deletion): no lost control, redaction intact, no CRITICAL/HIGH/MEDIUM |
| Commit/push | Complete | Committed on `ts-migration/backend`; PR #1 updated |

**Decisions:** `eslint.config.mjs` classified as a tooling exception; broader
typed config deferred to owning batches (no speculative adjacent work).

## Completed Slice: Deterministic OpenAPI Generator (CON-006)

**Status:** Complete (branch `ts-migration/backend`, PR #1 to `main`).

**Scope:** Build the single deterministic Zod -> committed OpenAPI 3.1 ->
`openapi-typescript` path-types pipeline in `packages/contracts`.
`scripts/generate-openapi.ts` registers the frozen public/activation/native-auth
operation descriptors into `@asteasolutions/zod-to-openapi`
(`OpenApiGeneratorV31`), hoists a shared `ErrorEnvelope` component via Zod 4
`.meta({ id })`, documents modeled request headers as parameters, and writes
`generated/openapi-v1.json`; `openapi-typescript` emits `generated/openapi-v1.d.ts`.
`generate`/`generate:check` (staleness) and `lint:openapi` (Redocly, minimal
ruleset) join `check`.

**Explicitly out of scope (deferred to CON-007):** the `openapi-fetch` client
factory (`src/client/**`), consumer `file:` installs, and generated `paths`/
OpenAPI package exports.

| Gate | Status | Evidence |
|---|---|---|
| Feasibility research | Complete | Spike confirmed zod-to-openapi 9 handles Zod 4 tuples/unions/strictObject |
| Tests before implementation | Complete | RED on missing generator module; a second RED proved the staleness gate catches drift |
| Implementation GREEN | Complete | 7 generator tests; full suite 120/120 |
| Determinism | Complete | sha256-identical regeneration across runs |
| Coverage >=80% | Complete | 100% statements/branches/functions/lines |
| Typecheck/lint/build/exports/Redocly | Complete | `npm run check` green on Node 22.22.3 / npm 11.16.0 |
| Reviews | Complete | semantic_reviewer: HIGH (dropped headers) fixed by documenting header parameters; MEDIUM (test breadth) fixed; one LOW tracked |
| JS deletion | N/A | Additive; backend backlog unchanged at 89 files / 12,600 lines |
| Commit/push | Complete | Committed on `ts-migration/backend`; PR #1 updated |

**Decisions:** shared component via Zod 4 `.meta({ id })` (333 KB inline -> 59 KB
$ref); `eslint.config.mjs` classified as a tooling exception; header parameters
documented (names only, no values); backward-compatibility snapshot gate tracked
as a later LOW.

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

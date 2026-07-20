# Current Resume Point

## Last Verified Code Checkpoint

- Task: `BE-010` native auth core (activation + login + logout + bearer guard),
  landed on branch `ts-migration/backend` (PR #1 to `main`). Accelerated mode:
  single BE task, critical-only tests.
- Result: `domain/auth/nativeAuth.ts` (`activateUser`, `nativeLogin`,
  `nativeLogout`, `authenticateNativeRequest`) + `routes/nativeAuthRoutes.ts`
  (`POST /v1/activations/complete`, `/v1/auth/native/{login,logout}`), backed by
  new `userRepository`/`activationInviteRepository` + extended
  `authSessionRepository`, `refreshDerivation.ts`, `phone.ts` (libphonenumber-js).
  Critical integration test proves activate -> active user/credential/session,
  replay -> TOKEN_ALREADY_USED, login + same-device replacement, wrong/unknown ->
  INVALID_CREDENTIALS, logout family-revoke + bearer required. `check` green;
  integration 31/31 (coverage 97.56% stmts). Additive — no JS deleted (80).
- BE-010 remaining: native refresh rotation (30s grace + reuse revoke), web
  cookie/CSRF auth, production `server.ts` wiring, delete legacy auth trio.
- Prior checkpoints: BE-010a, BE-009d (closed BE-009), BE-009c/b/a, BE-008c,
  BE-008b-2/1, BE-008a, BE-006, BE-007g (closed BE-007), BE-007f..a, BE-005,
  BE-004, BE-003, CON-006, BE-002.

## Superseded Code Checkpoint (BE-010a)

- Task: `BE-010a` auth session + credential repositories (child of BE-010),
  landed on branch `ts-migration/backend` (PR #1 to `main`).
- Result: `src/repositories/credentialRepository.ts` (exists/create, Argon2id
  hash stored only) and `src/repositories/authSessionRepository.ts`
  (createNativeSession = session + generation-0 refresh atomically;
  lockByRefreshTokenHash with row locks; revokeAllForUser with counts). Proven on
  PostgreSQL 16 (create/lookup/revoke). Unit `check` green; integration green
  (coverage 99.64% stmts). Additive — no JS deleted (80).
- Prior checkpoints: BE-009d (closed BE-009), BE-009c, BE-009b, BE-009a, BE-008c,
  BE-008b-2/1, BE-008a, BE-006, BE-007g (closed BE-007), BE-007f..a, BE-005,
  BE-004, BE-003, CON-006, BE-002.

## Superseded Code Checkpoint (BE-009d)

- Task: `BE-009d` refresh/CSRF session-token primitives (child of BE-009,
  **closes BE-009**), landed on branch `ts-migration/backend` (PR #1 to `main`).
- Result: `src/auth/sessionTokens.ts` — opaque refresh + CSRF token generation,
  keyed HMAC-SHA-256 hashing under distinct versioned keys, and constant-time
  verification; own 2-key config so the public-onboarding `CryptoContext` is
  unchanged. **Deleted `src/security/tokens.js` (HS256) — backend JS 81 -> 80.**
  Unit `check` green; integration 24/24. **BE-009 (security core) DONE** (a-d:
  Argon2id, HIBP, ES256, refresh/CSRF); `security/auth.js` deletion + rotation
  state machine -> BE-010.
- Prior checkpoints: BE-009c, BE-009b, BE-009a, BE-008c, BE-008b-2/1, BE-008a,
  BE-006, BE-007g (closed BE-007), BE-007f..a, BE-005, BE-004, BE-003, CON-006,
  BE-002.

## Superseded Code Checkpoint (BE-009c)

- Task: `BE-009c` ES256 access-token service (child of BE-009), landed on branch
  `ts-migration/backend` (PR #1 to `main`).
- Result: `src/auth/accessToken.ts` (`createAccessTokenService`) — ES256-only
  sign/verify via `jose`; signs with the current `kid` (header alg/kid/typ +
  iss/aud/sub/sid/jti/iat/nbf/exp, 10-min TTL); verify rejects missing/unknown
  `kid`, pins issuer/audience/ES256/`typ=access`/<=30s skew, and collapses every
  failure to AUTHENTICATION_REQUIRED; keys imported lazily + cached. Unit `check`
  green (jose in dist smoke); integration 24/24. Additive — no JS deleted (81).
- Prior checkpoints: BE-009b, BE-009a, BE-008c, BE-008b-2/1, BE-008a, BE-006,
  BE-007g (closed BE-007), BE-007f..a, BE-005, BE-004, BE-003, CON-006, BE-002.

## Superseded Code Checkpoint (BE-009b)

- Task: `BE-009b` breached-password check (child of BE-009), landed on branch
  `ts-migration/backend` (PR #1 to `main`).
- Result: `src/auth/breachCheck.ts` — HIBP k-anonymity checker (sends only the
  5-char SHA-1 prefix, `Add-Padding: true`, 2s timeout, constant-time 35-char
  suffix compare, 24h bounded prefix cache; positive count -> VALIDATION_FAILED;
  non-2xx/reject -> DEPENDENCY_UNAVAILABLE fail-closed; `bypass` only in
  test/development). `fetch` is injectable so unit tests are offline. Unit `check`
  green; integration 24/24. Additive — no JS deleted (81).
- Prior checkpoints: BE-009a, BE-008c, BE-008b-2, BE-008b-1, BE-008a, BE-006,
  BE-007g (closed BE-007), BE-007f..a, BE-005, BE-004, BE-003, CON-006, BE-002.

## Superseded Code Checkpoint (BE-009a)

- Task: `BE-009a` Argon2id password hasher (child of BE-009), landed on branch
  `ts-migration/backend` (PR #1 to `main`).
- Result: `src/auth/passwordHasher.ts` (OWASP Argon2id hash/verify + timing-safe
  dummy verify + `passwordInputSchema` 12-128 code points no control) using the
  pinned native `argon2@0.44.0` (prebuilt binary loads in source + dist smoke);
  `jose@6.2.3` pinned for BE-009c. **Deleted `src/security/passwords.js` (scrypt)
  — backend JS 82 -> 81.** Unit `check` green; integration 24/24.
- Prior checkpoints: BE-008c, BE-008b-2, BE-008b-1, BE-008a, BE-006, BE-007g
  (closed BE-007), BE-007f..a, BE-005, BE-004, BE-003, CON-006, BE-002.

## Superseded Code Checkpoint (BE-008c)

- Task: `BE-008c` verify-email route + first onboarding JS deletion (child of
  BE-008), landed on branch `ts-migration/backend` (PR #1 to `main`).
- Result: `POST /v1/applications/verify-email` end-to-end on PostgreSQL 16. The
  `verifyApplicationEmail` command locks the token by hash `FOR UPDATE`, rejects
  unknown/revoked (`TOKEN_INVALID` 400), consumed (`TOKEN_ALREADY_USED` 409), and
  expired (`TOKEN_EXPIRED` 410), and otherwise consumes the token + transitions
  the application `pending_email_verification -> submitted` atomically with an
  audit event; response `{verified:true}` leaks no id/state. **Deleted
  `src/website/services/onboardingService.js` — the first backend JS deletion
  (83 -> 82)** — guarded by `legacy-deletion.guard.test.ts` (verified no TS
  consumer; legacy graph has no entrypoint). Unit `check` green; integration
  24/24 (coverage gate 99.58% stmts).
- Prior checkpoints: BE-008b-2, BE-008b-1, BE-008a, BE-006, BE-007g (closed
  BE-007), BE-007f..a, BE-005, BE-004, BE-003, CON-006, BE-002.

## Superseded Code Checkpoint (BE-008b-2)

- Task: `BE-008b-2` application submission route (child of BE-008), landed on
  branch `ts-migration/backend` (PR #1 to `main`).
- Result: `POST /v1/applications` end-to-end on PostgreSQL 16. Seven repository
  implementations (application/consent/verification-token/outbox/email-delivery/
  audit/idempotency), the `submitApplication` command (consent resolution +
  active-conflict no-op + atomic create), and the route (Idempotency-Key + Zod
  body + normalization + request hash + unit-of-work + `executeIdempotent`). A new
  pair returns 202 and atomically creates application+2 consents+token+queued
  verify_email delivery+outbox+audit; a repeated key replays; a duplicate identity
  is a uniform 202 no-op; missing key / stale consent -> 400. Corrected
  `executeIdempotent` (check-completed-first) and `maskEmail` (full domain).
  Unit `check` green; integration 21/21 with a new integration coverage gate over
  repositories/routes/domain (99.48% stmts). Additive — no JS deleted (83).
- Prior checkpoints: BE-008b-1, BE-008a, BE-006, BE-007g (closed BE-007),
  BE-007f..a, BE-005, BE-004, BE-003, CON-006, BE-002.

## Superseded Code Checkpoint (BE-008b-1)

- Task: `BE-008b-1` onboarding crypto primitives (child of BE-008), landed on
  branch `ts-migration/backend` (PR #1 to `main`).
- Result: `src/crypto/primitives.ts` (opaque 43-char base64url token, keyed
  HMAC-SHA-256, AES-256-GCM envelope with 12-byte nonce + appended 16-byte tag,
  constant-time compare, email mask) and `src/crypto/context.ts` (`parseCryptoKeys`
  decodes/length-validates four base64 keys + versions; `createCryptoContext`
  binds them into token/HMAC/envelope/mask helpers). Pure `node:crypto`, fully
  unit-tested (round-trip, tamper rejection, format, key-length). `check` green;
  integration unchanged (16/16). Additive — no JS deleted (83).
- Prior checkpoints: BE-008a, BE-006, BE-007g (closed BE-007), BE-007f..a,
  BE-005, BE-004, BE-003, CON-006, BE-002.

## Superseded Code Checkpoint (BE-008a)

- Task: `BE-008a` public consent-documents route (child of BE-008), landed on
  branch `ts-migration/backend` (PR #1 to `main`).
- Result: the first canonical `/v1` route end-to-end. `src/repositories/consentRepository.ts`
  (`findCurrentDocuments` — current, non-retired docs per kind) and
  `src/routes/publicOnboardingRoutes.ts` register `GET /v1/public/consent-documents`,
  which returns a success envelope of the current terms/privacy documents with
  `publicPath`, `contentMarkdown`, and lowercase-hex `sha256`. Proven on
  PostgreSQL 16 through the typed Fastify app (`app.inject`) after migrate + seed
  (integration 16/16 across 2 files). Unit `check` green. Additive — no JS
  deleted (83); onboarding JS deletion lands in BE-008c.
- Prior checkpoints: BE-006, BE-007g (closed BE-007), BE-007f, BE-007e, BE-007d,
  BE-007c, BE-007b, BE-007a, BE-005, BE-004, BE-003, CON-006, BE-002.

## Superseded Code Checkpoint (BE-006)

- Task: `BE-006` Fastify HTTP boundary primitives, landed on branch
  `ts-migration/backend` (PR #1 to `main`).
- Result: typed HTTP boundary in `src/http/{errorCatalog,envelope,validation,idempotencyProtocol,boundary}.ts`
  wired into `createApplication`: request-id resolution (valid `X-Request-Id`
  UUID or fresh), the canonical `{ok,data,error,meta}` envelope via
  `reply.sendData`, the stable `ErrorCode` catalog + internal->public mapping +
  `AppError`, `MAX_JSON_BODY_BYTES=65536` (413) and media-type (415) enforcement,
  Zod `parseOrThrow`, and the pure `executeIdempotent` orchestrator over the
  `IdempotencyRepository` interface. `renderError` never leaks internal/SQL/stack
  text. Unit + Fastify `inject` tests green; integration unchanged (15/15). New
  boundary modules 100% covered. Additive — no JS deleted (83); legacy
  `src/http/*.js` deletion is BE-019.
- Note: new modules are named `errorCatalog`/`idempotencyProtocol` to avoid a
  `.ts`<->`.js` basename collision with legacy `errors.js`/`idempotency.js` under
  Vite resolution (RED hit and fixed this batch).
- Prior checkpoints: BE-007g (closed BE-007), BE-007f, BE-007e, BE-007d, BE-007c,
  BE-007b, BE-007a, BE-005, BE-004, BE-003, CON-006, BE-002.

## Superseded Code Checkpoint (BE-007g)

- Task: `BE-007g` typed idempotent bootstrap seed (child of BE-007, **closes
  BE-007**), landed on branch `ts-migration/backend` (PR #1 to `main`).
- Result: `src/db/seedCatalog.ts` publishes the authoritative catalog (5 roles;
  21 single-dot `domain.action` permissions; least-privilege role->permission
  map with superadmin holding all; current terms/privacy consent docs) and
  `buildSeedStatements()` (idempotent `ON CONFLICT DO NOTHING` inserts with a
  TS-computed SHA-256 matching the pgcrypto digest CHECK). `src/scripts/seed.ts`
  runs them in one transaction (+ CLI; `seed`/`seed:dev` scripts). Proven on
  PostgreSQL 16 (integration 15/15: applies the catalog + is idempotent on a
  second run). Unit `check` green. Additive — no JS deleted (83). Grants + admin
  user + Argon2id credential deferred to the security bootstrap (BE-009/BE-016)
  per spec 02 §3.5.
- **BE-007 (canonical identity/onboarding schema) is DONE** (children a-g). The
  canonical schema (migrations 009-013), its typed §7 contract, and the bootstrap
  seed are complete. Prior checkpoints: BE-007f, BE-007e, BE-007d, BE-007c,
  BE-007b, BE-007a, BE-005, BE-004, BE-003, CON-006, BE-002.

## Superseded Code Checkpoint (BE-007f)

- Task: `BE-007f` Kysely schema types + repository interfaces (child of BE-007),
  landed on branch `ts-migration/backend` (PR #1 to `main`).
- Result: `src/db/types.ts` now defines the full canonical `Database` map (all 23
  first-slice tables mirroring migrations `009`-`013`), `src/db/repositories.ts`
  transcribes spec §7 as a type-only contract (ReadonlyDeep, Row<T>, branded ids,
  cursor/query/command inputs, all 24 repository interfaces with a caller-owned
  `Transaction`), and `src/db/limits.ts` (+ unit test) pins the §7 numeric
  ceilings. A typed Kysely round-trip on `applications`/`roles`/`outbox_events`
  proves the schema types match the live DDL (defaulted enum, bigint-as-string,
  jsonb-object, timestamptz-as-Date). Integration 14/14; unit `check` green
  (coverage 87.88%). Additive — no JS deleted (83). Repository implementations
  are deferred to the consuming route/command batches (BE-008+).
- BE-007 parent remains ACTIVE. Prior checkpoints: BE-007e, BE-007d, BE-007c,
  BE-007b, BE-007a, BE-005, BE-004, BE-003, CON-006, BE-002.

## Superseded Code Checkpoint (BE-007e)

- Task: `BE-007e` canonical outbox/email delivery tables (child of BE-007),
  landed on branch `ts-migration/backend` (PR #1 to `main`).
- Result: additive migration `db/migrations/013_canonical_outbox_email.sql` adds
  enums `outbox_state`/`email_delivery_state` and 4 tables — `outbox_events`,
  `email_deliveries`, `email_provider_events`, `email_suppressions` — with their
  §3.3 constraints (unique dedup key + transit-only all-or-null lease group;
  template<->subject FK matrix; recipient HMAC 32 bytes; all-or-null recipient /
  failure / provider AES-256-GCM envelopes with 12-byte nonce, GCM tag, and
  post-erasure nulling; unique SNS message id with valid-but-unknown correlation
  still committing as unmatched; suppression composite PK + lift group). Proven
  on PostgreSQL 16 (integration 13/13). Unit `check` green. Additive — no JS
  deleted (83).
- BE-007 parent remains ACTIVE. Prior checkpoints: BE-007d, BE-007c, BE-007b,
  BE-007a, BE-005, BE-004, BE-003, CON-006, BE-002.

## Superseded Code Checkpoint (BE-007d)

- Task: `BE-007d` canonical RBAC/audit/platform tables (child of BE-007), landed
  on branch `ts-migration/backend` (PR #1 to `main`).
- Result: additive migration `db/migrations/012_canonical_rbac_platform.sql` adds
  enums `approval_state`/`actor_type` and 9 tables — `roles`, `permissions`,
  `role_permissions`, `user_roles`, `approval_actions`, `audit_events`,
  `idempotency_records`, `rate_limit_windows`, `legal_holds` — with their §3.3
  constraints (snake_case role codes; one active grant per pair; closed 8-code
  maker-checker action set with maker<>checker; idempotency scope uniqueness;
  positive rate-limit counts; legal-hold allowlist + one-unreleased-per-entity;
  NULL-safe all-or-nothing groups). Proven on PostgreSQL 16 (integration 12/12).
  Unit `check` green. Additive — no JS deleted (83).
- BE-007 parent remains ACTIVE. Prior checkpoints: BE-007c, BE-007b, BE-007a,
  BE-005, BE-004, BE-003, CON-006, BE-002.
- Result: additive migration `db/migrations/011_canonical_sessions.sql` adds
  enums `session_channel`/`auth_session_state` and tables `auth_sessions`
  (one-active-native-session-per-device partial unique; all-or-nothing
  previous-refresh/CSRF groups; native-CSRF-null vs web-CSRF-present rules) and
  `auth_refresh_tokens` (single-current-token partial unique; composite
  `(session_id, user_id)` cascade FK). Proven on PostgreSQL 16 (integration
  11/11), including NULL-safe CHECK fixes so partial CSRF/pair values are truly
  rejected. Unit `check` green. Additive — no JS deleted (83).
- BE-007 parent remains ACTIVE. Prior checkpoints: BE-007b, BE-007a, BE-005,
  BE-004, BE-003, CON-006, BE-002.
- Result: additive migration `db/migrations/010_canonical_identity.sql` adds
  enums `user_account_state`/`activation_invite_state`/`application_decision` and
  tables `users`, `user_credentials`, `application_reviews`, `activation_invites`
  (composite `(user_id, application_id)` ownership FK, one-pending-per-user), and
  attaches `verification_tokens.user_id -> users(id)`. Proven on PostgreSQL 16:
  identity uniqueness, Argon2id hash-prefix + lock-window credential invariants,
  one-review-per-application, one-pending-invite, and the verification-token user
  FK. Integration 10/10; unit `check` green. Additive — no JS deleted (83).
- Known risk (recorded in RISKS): canonical `users` collides by name with legacy
  `001` on a mixed `migrate up`; canonical migrations run in isolation (`>= 009`)
  and legacy is archived at CLEAN-002.
- BE-007 parent remains ACTIVE. Prior checkpoints: BE-007a, BE-005, BE-004,
  BE-003, CON-006, BE-002.
- Result: additive migration `db/migrations/009_canonical_onboarding.sql` adds
  enums `application_state`/`token_purpose` and tables `applications`,
  `consent_documents`, `application_consents`, `verification_tokens` with the
  §3.1 constraints/partial-unique indexes. Proven on empty PostgreSQL 16 via the
  BE-005 runner: unique-active email/phone + reuse-after-rejection, phone-format
  check, `digest()`-backed consent SHA-256 check, one-pending-token index.
  Integration 8/8; unit `check` green. Additive — no JS deleted (backlog 83).
- BE-007 parent remains ACTIVE: next child BE-007b adds `users`/credentials/
  invites/sessions/refresh-tokens/reviews (+ the deferred
  `verification_tokens.user_id` FK), then RBAC/audit, outbox/email, repositories,
  and the typed bootstrap seed.
- DB integration tests run via `npm run test:integration` (podman-runtime
  wrapper).
- Prior checkpoints: BE-005, BE-004, BE-003, CON-006, BE-002.
- Result: emitted TypeScript operational commands over the BE-004 typed pool —
  `src/scripts/migrate.ts` (ordered, checksummed, per-migration transactional,
  idempotent apply tracked in `schema_migrations`; `status|up` CLI) and
  `src/scripts/check-db.ts`. Deleted the legacy `scripts/migrate.js`,
  `check-db.js`, `seed-auth.js`. Backend authored JS backlog **86 -> 83**. Unit
  42 tests (>=80% overall); integration 4/4 vs PostgreSQL 16 (incl. idempotent
  migrate). Typed bootstrap seed deferred to BE-007 (needs canonical schema).
- Prior checkpoint (foundation, no deletion):

## Prior Checkpoint (BE-004)

- Task: `BE-004` PostgreSQL/Kysely foundation, landed on branch
  `ts-migration/backend` (PR #1 to `main`).
- Result: typed owned `pg` pool (`src/db/pool.ts`), typed Kysely instance +
  explicit unit-of-work transaction (`src/db/database.ts`), Zod DB config
  (`src/db/config.ts`), and `Database` type (`src/db/types.ts`), proven by a
  Testcontainers integration test against PostgreSQL 16 (pooled query + commit +
  rollback, 3/3). Unit `check` green (34 tests, coverage >=80% all metrics).
  Container-runtime feasibility solved: this podman-only sandbox has no Docker
  socket, so `scripts/with-container-runtime.ts` starts a temporary
  `podman system service` (ryuk disabled, log-based wait); real CI Docker
  sockets are used unchanged. GATE-02 deviation recorded (authorized to unblock
  the deletion-heavy persistence/identity batches). No JS deleted this batch.
- Environment knowledge for resume: run DB integration tests with
  `npm run test:integration` (wraps vitest in the podman-runtime provisioner).
- Prior checkpoints on this branch: `BE-003` (config closure, first backend JS
  deletion, 89->86), `CON-006` (OpenAPI generator), `BE-002` (graceful lifecycle).

## Prior Checkpoint (BE-002)

- Task: `BE-002` graceful API lifecycle, landed on branch `ts-migration/backend`.
- Baseline before this batch: `main` at `f991298`; earlier runtime reset
  `9e884ad` (BE-001).
- Result: bounded graceful `SIGTERM`/`SIGINT` drain in
  `backend_controller/src/runtime/shutdown.ts`, wired into `server.ts`; the
  process now drains via Fastify `close()` and exits `0` on a clean close, `1`
  on timeout/error, instead of Node's default signal termination. Additive
  only — no backend JS deleted (backlog stays 89 files / 12,600 lines).
- Validation: Node 22.22.3/npm 11.16.0 `npm run check` green — 27 tests,
  coverage 93.69% stmts / 91.89% branch / 90.9% funcs (`shutdown.ts`
  97.18%/95%/80%), build, and source+dist smoke asserting SIGTERM -> exit 0.
  semantic_reviewer review: no CRITICAL/HIGH; one MEDIUM and two LOW resolved.
- Guards: `git diff --check` clean; Legacy tree hash matches
  `d5fd7425...`; branch pushed to `dev`.

## Active Task

- None active. `CON-007` consumer contract/package wiring is the next batch
  (owner `packages/contracts` + consumer manifests): the `openapi-fetch` client
  factory over the generated `paths`, `@beonedge/contracts` `file:` consumption,
  and generated `paths`/OpenAPI package exports. Its packet/log must be
  instantiated before it becomes `ACTIVE`.
- `DOC-001` remains in `REVIEW` (documentation-only; its Legacy guard now
  reproduces since the Legacy tree is present).

## Next Code Tasks

1. `BE-010b` activation route: consume invite -> Argon2id credential + native
   session + refresh + activate user + audit, atomically (invite/user/credential
   repos + passwordHasher + breachCheck + sessionTokens + accessToken).
2. `BE-010c` login/refresh-rotation/logout + Fastify auth guard; delete
   `security/auth.js` + legacy auth routes.
3. `BE-011` readiness/health endpoints; `BE-012` SES/SNS outbox worker.
   deleting the onboarding service JS (`website/services`).
3. `CON-007` consumer contract/package wiring (openapi-fetch client factory).

Before a candidate becomes `READY`, create its complete packet and dedicated log
under Session 1. Dependencies and acceptance remain authoritative in
[TASKS.md](../TASKS.md).

## Resume Commands

```bash
git status --short
git log -5 --oneline
git diff --check
find resources/sessions/1 -maxdepth 3 -type f -print | sort
test "$(find resources/sessions/Legacy -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1)" = "d5fd7425d67bce6f52da178dbce9f5c27d0f36921d838115ccc9631755e93fee"
```

Then read [WORKING_MODEL.md](../WORKING_MODEL.md), the linked migration packet,
and its task log.

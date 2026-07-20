# Current Resume Point

## Last Verified Code Checkpoint

- Task: `BE-007b` canonical identity/invite tables (child of BE-007), landed on
  branch `ts-migration/backend` (PR #1 to `main`).
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

1. `BE-007c` — `auth_sessions` + `auth_refresh_tokens` (refresh/CSRF rotation
   columns, one-active-native-session-per-device, refresh-token cascade); then
   BE-007d RBAC/audit/idempotency/rate-limit/legal-holds, BE-007e outbox/email,
   BE-007f repositories, BE-007g bootstrap seed.
2. `BE-008` public consent/application/verification Fastify routes — begins
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

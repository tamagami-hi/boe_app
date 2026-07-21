# BE-007g Phase Log: Typed Idempotent Bootstrap Seed

Status: `DONE`

## Objective And Dependency Closure

- Objective: always-run idempotent seed for the role/permission catalog and
  current consent documents, over the typed pool.
- Dependencies: BE-007a-f (`DONE`). Closes parent BE-007.
- Normative sources: `specifications/02` §3.5, `03` §3.3, `04` role/permission
  catalog.
- Dominant risk: non-idempotent seed / invalid permission code.
- Intentional behavior change: none (additive bootstrap data).

## Atomic Units

- [x] Author `src/db/seedCatalog.ts` (roles, permissions, role->permission map,
      consent docs; `buildSeedStatements()` with TS-computed SHA-256).
- [x] Author `src/scripts/seed.ts` (transactional runner + CLI) and wire
      `seed`/`seed:dev` package scripts.
- [x] Unit tests: catalog validity + runner order/rollback (fake pool).
- [x] Integration test: run seed twice, assert catalog present + stable counts.
- [x] `npm run check` green; `npm run test:integration` green (15/15).
- [x] Records updated; commit/push.

## Replacement And Deletion Map

| New | Superseded | Guard |
|---|---|---|
| `src/db/seedCatalog.ts` + `src/scripts/seed.ts` | legacy `scripts/seed-auth.js` (already deleted at BE-005) | unit + idempotency integration test |

## Research And Reuse

- Runner mirrors the BE-005 `migrate.ts` transaction/CLI pattern over the typed
  pool. Consent digest reuses `node:crypto` `createHash` so the value equals the
  `pgcrypto` `digest(content_markdown, 'sha256')` CHECK.

## RED Evidence

- Honest note: no separate failing run was captured; the catalog, runner, and
  tests were authored together and validated GREEN. The idempotency guard is the
  integration test that runs `runSeed` twice and asserts unchanged row counts,
  and the unit test that asserts `ON CONFLICT` on every statement.
- Correctness care: permission codes are single-dot `domain.action` labels to
  satisfy `permissions_code_check` (the two-dot `rbac.permissions.change` string
  belongs to `approval_actions.action_type`, a different fixed set); `ON CONFLICT
  (kind, version)` skips the whole consent row so the `public_path`/current-kind
  unique indexes are never violated on a repeat run.

## Implementation And Decisions

- `src/db/seedCatalog.ts` publishes the authoritative catalog: `SEED_ROLES`
  (`superadmin`/`onboarding`/`finance`/`content`/`support`), `SEED_PERMISSIONS`
  (21 single-dot codes covering the spec 04 role table plus the superadmin
  extras `users.suspend`/`users.close`/`roles.assign`/`permissions.change`),
  `SEED_ROLE_PERMISSIONS` (superadmin holds all; the others least-privilege), and
  `SEED_CONSENT_DOCUMENTS` (current terms/privacy `v1`). `buildSeedStatements()`
  returns idempotent `ON CONFLICT DO NOTHING` inserts with a TS-computed SHA-256
  for each consent document.
- `src/scripts/seed.ts` runs the statements in one transaction (thin runner +
  `isMainModule` CLI), and `package.json` gains `seed`/`seed:dev`.
- Decisions/deferrals: `role_permissions`/`user_roles` grants and the optional
  admin user + Argon2id credential + redacted audit event are the security
  bootstrap transaction (they need a granting user; `granted_by_user_id` is NOT
  NULL). They derive from `SEED_ROLE_PERMISSIONS` and land with BE-009/BE-016.
  No admin credential is compiled into source (spec 02 §3.5). Consent documents
  are seeded as clearly-labelled placeholders the content admin replaces.

## GREEN Validation

| Gate | Command | Result |
|---|---|---|
| Unit check | `npm run check` | green (typecheck + lint + coverage + build + smoke); `seedCatalog.ts` 100%, `seed.ts` 75% (CLI block only, mirrors `migrate.ts`) |
| Integration | `npm run test:integration` | 15/15 vs PostgreSQL 16 (seed applies catalog + is idempotent on a second run) |

## Reviews

- Code + security (focused inline review): the seed contains only catalog rows —
  no admin email/phone/name/password/hash is compiled into source, examples, or
  images (spec 02 §3.5); grants that need a granting user are correctly deferred;
  permission codes pass the DB `domain.action` CHECK; idempotency is proven, so
  re-running the seed on an existing environment is safe. No CRITICAL/HIGH/MEDIUM.

## Metrics

- Source TS added: `src/db/seedCatalog.ts`, `src/scripts/seed.ts` (+ 2
  package scripts).
- Test TS added: `src/db/seedCatalog.test.ts`, `src/scripts/seed.test.ts` (unit
  45 -> 51) + 1 integration idempotency test (integration 14 -> 15).
- Production JS/JSX deleted: 0 (the legacy `seed-auth.js` was deleted at BE-005).
  Backend authored JS backlog unchanged at 83 files.

## Risk, Rollback, And Resume

- Residual risk: the catalog is not yet granted to any user (deferred to the
  security bootstrap), so RBAC checks have nothing to resolve until BE-009/BE-016.
- Rollback shape: revert the BE-007g commit; remove the seed module/script.
- Commit/push: conventional commit on `ts-migration/backend`; PR #1 updated.
- **BE-007 (canonical identity/onboarding schema) is now DONE** (children
  a-g complete). Exact next action: BE-006 — Fastify HTTP boundary primitives
  (request IDs, response envelopes, Zod input/output, body limits, idempotency),
  the foundation the route batches consume before the first onboarding JS
  deletion in BE-008.

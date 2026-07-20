# BE-007b Phase Log: Canonical Identity/Invite Tables

Status: `DONE`

## Objective And Dependency Closure

- Objective: additive canonical `users`, `user_credentials`,
  `application_reviews`, `activation_invites` + `verification_tokens.user_id` FK,
  proven on empty PostgreSQL 16.
- Dependencies: BE-007a (`DONE`), BE-004/BE-005. Parent BE-007 stays in progress.
- Normative sources: `specifications/03` §2.1/§2.2/§3.1/§3.2.
- Dominant risk: wrong ownership/uniqueness/credential invariants.
- Intentional behavior change: none (additive).

## Atomic Units

- [x] Author `010_canonical_identity.sql` (3 enums + 4 tables + verification FK).
- [x] Extend the canonical-schema integration test (filter runner to `>= 009`;
      assert identity uniqueness, credential invariants, one review/app, one
      pending invite/user, verification-token user FK).
- [x] `npm run check` green; `npm run test:integration` green (10/10).
- [x] Records + RISKS legacy-collision decision recorded; commit/push.

## Replacement And Deletion Map

| New | Superseded JS deleted | Guard |
|---|---|---|
| `db/migrations/010_canonical_identity.sql` | none (additive) | integration assertions on real PG |

## Research And Reuse

- Reused BE-005 runner + BE-004 harness; canonical migrations applied in
  isolation (versions `>= 009`) to avoid the legacy `users` name collision.

## RED Evidence

- Honest note: as with BE-007a, a separate failing run was not captured for this
  schema increment; the migration and its constraint assertions were authored
  together and validated GREEN on the first integration run. The assertions
  encode the intended contract (they only pass because the constraints exist).

## Implementation And Decisions

- `010_canonical_identity.sql` adds enums `user_account_state`,
  `activation_invite_state`, `application_decision`; tables `users` (unique
  email/phone, unique `(id, application_id)`, live-PII + state-timestamp checks),
  `user_credentials` (Argon2id hash prefix, lock-window invariant),
  `application_reviews` (one per application; `(reviewer, idempotency_key)`
  unique), `activation_invites` (composite `(user_id, application_id)` ownership
  FK, one-pending-per-user partial index); and attaches
  `verification_tokens.user_id -> users(id)`.
- Decision (legacy collision): canonical `users` shares the legacy `001` table
  name, so a full `migrate up` over the legacy chain would collide. Canonical
  migrations are validated in isolation (`>= 009`); there is no data and the
  legacy chain is archived at CLEAN-002. Recorded in
  `decisions/RISKS_AND_DECISIONS.md`.
- Deferrals: `auth_sessions`/`auth_refresh_tokens` -> BE-007c; RBAC/audit/
  idempotency/outbox/email -> later children; repositories -> BE-007e; bootstrap
  seed -> BE-007f.

## GREEN Validation

| Gate | Command | Result |
|---|---|---|
| Unit check | `npm run check` | green (42 tests, coverage >=80%) |
| Integration | `npm run test:integration` | 10/10 vs PostgreSQL 16 |

## Reviews

- Code + security (focused inline review): ownership via composite FKs, identity
  uniqueness, credential Argon2id-prefix + lock-window invariants, one-review /
  one-pending-invite guards, and the verification-token user FK all verified by
  integration assertions. Additive; no CRITICAL/HIGH/MEDIUM. Fuller review on PR #1.

## Metrics

- Schema SQL added: `010_canonical_identity.sql` (4 tables, 3 enums, 1 FK).
- Test TS added: 2 integration tests (suite 8 -> 10).
- Production JS/JSX deleted: 0 (additive). Backend authored JS backlog unchanged
  at 83 files.

## Risk, Rollback, And Resume

- Residual risk: sessions/RBAC/repositories not yet present; schema not consumed
  by a route yet; legacy `users` collision on a mixed `migrate up` (documented).
- Rollback shape: revert the BE-007b commit; remove `010`.
- Commit/push: conventional commit on `ts-migration/backend`; PR #1 updated.
- Exact next action: BE-007c — `auth_sessions` + `auth_refresh_tokens` (refresh/
  CSRF rotation columns) with concurrency constraints.

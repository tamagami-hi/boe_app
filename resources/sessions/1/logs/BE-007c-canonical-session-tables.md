# BE-007c Phase Log: Canonical Session Tables

Status: `DONE`

## Objective And Dependency Closure

- Objective: additive `auth_sessions` + `auth_refresh_tokens` proven on empty
  PostgreSQL 16.
- Dependencies: BE-007b (`DONE`). Parent BE-007 stays in progress.
- Normative sources: `specifications/03` §2.1/§3.2.
- Dominant risk: wrong session/refresh invariants.
- Intentional behavior change: none (additive).

## Atomic Units

- [x] Author `011_canonical_sessions.sql` (2 enums + 2 tables + constraints).
- [x] Extend the canonical-schema integration test: device-unique native
      session, native/web CSRF rules, one current refresh token, cascade FK.
- [x] `npm run check` green; `npm run test:integration` green (11/11).
- [x] Records updated; commit/push.

## Replacement And Deletion Map

| New | Superseded JS deleted | Guard |
|---|---|---|
| `db/migrations/011_canonical_sessions.sql` | none (additive) | integration assertions on real PG |

## Research And Reuse

- Reused BE-005 runner + BE-004 harness; canonical migrations applied in
  isolation (versions `>= 009`).

## RED Evidence

- Honest note: as with BE-007a/b, no separate failing run was captured; the
  migration and its assertions were authored together and validated GREEN.
- Correctness fix during authoring: Postgres CHECK constraints pass when the
  expression is NULL, so the "web requires CSRF" and "all-or-nothing pair"
  checks were rewritten with explicit `IS NOT NULL` guards so partial/null
  values are actually rejected (verified by the CSRF assertions).

## Implementation And Decisions

- `011_canonical_sessions.sql` adds enums `session_channel`,
  `auth_session_state`; `auth_sessions` (unique `token_family_id` and
  `(id, user_id)`; partial-unique one-active-native-session per `(user_id,
  device_id_hash)`; generation/keyver/device-hash checks; all-or-nothing
  previous-refresh and previous-CSRF groups; native-CSRF-null vs web-CSRF-present
  rules; terminal-state timestamp checks); `auth_refresh_tokens` (composite
  `(session_id, user_id) -> auth_sessions(id, user_id) ON DELETE CASCADE`; unique
  `token_hash` and `(session_id, generation)`; partial-unique single-current
  token; 32-byte hash / expiry / used-xor-revoked checks).
- Decisions/deferrals: exact 30-second previous-pair grace and rotation-id
  lifecycle are app/command-enforced; the DB enforces structural invariants.
  RBAC/audit/outbox/email, repositories, and the bootstrap seed follow.

## GREEN Validation

| Gate | Command | Result |
|---|---|---|
| Unit check | `npm run check` | green (42 tests, coverage >=80%) |
| Integration | `npm run test:integration` | 11/11 vs PostgreSQL 16 |

## Reviews

- Code + security (focused inline review): device-scoped single active native
  session, single current refresh token, channel/CSRF null rules, all-or-nothing
  pairs, and the cascade FK verified by integration assertions; the NULL-safe
  CHECK correction closes a real gap. Additive; no CRITICAL/HIGH/MEDIUM.

## Metrics

- Schema SQL added: `011_canonical_sessions.sql` (2 tables, 2 enums).
- Test TS added: 1 integration test (suite 10 -> 11).
- Production JS/JSX deleted: 0 (additive). Backend authored JS backlog unchanged
  at 83 files.

## Risk, Rollback, And Resume

- Residual risk: RBAC/audit/outbox/email/repositories not yet present; schema
  not consumed by a route yet; legacy collision documented.
- Rollback shape: revert the BE-007c commit; remove `011`.
- Commit/push: conventional commit on `ts-migration/backend`; PR #1 updated.
- Exact next action: BE-007d — RBAC (`roles`, `permissions`, `role_permissions`,
  `user_roles`), `approval_actions`, `audit_events`, `idempotency_records`,
  `rate_limit_windows`, `legal_holds`.

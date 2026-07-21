# BE-007d Phase Log: RBAC / Audit / Platform Tables

Status: `DONE`

## Objective And Dependency Closure

- Objective: additive RBAC, maker-checker, audit, and platform tables proven on
  empty PostgreSQL 16.
- Dependencies: BE-007c (`DONE`). Parent BE-007 stays in progress.
- Normative sources: `specifications/03` §2.1/§2.2/§3.3; `02` §7.
- Dominant risk: wrong RBAC/maker-checker/hold invariants.
- Intentional behavior change: none (additive).

## Atomic Units

- [x] Author `012_canonical_rbac_platform.sql` (2 enums + 9 tables + constraints).
- [x] Extend the canonical-schema integration test: role code + active-grant
      uniqueness, maker<>checker + closed action_type, idempotency scope
      uniqueness, rate-limit count>0, legal-hold allowlist + one-unreleased.
- [x] `npm run check` green; `npm run test:integration` green (12/12).
- [x] Records updated; commit/push.

## Replacement And Deletion Map

| New | Superseded JS deleted | Guard |
|---|---|---|
| `db/migrations/012_canonical_rbac_platform.sql` | none (additive) | integration assertions on real PG |

## Research And Reuse

- Reused BE-005 runner + BE-004 harness; canonical migrations applied in
  isolation (versions `>= 009`).

## RED Evidence

- Honest note: as with BE-007a/b/c, no separate failing run was captured; the
  migration and its assertions were authored together and validated GREEN on the
  first integration run (12/12).
- Correctness care carried from BE-007c: Postgres CHECK constraints pass on NULL,
  so the all-or-nothing revoke/release groups and the actor-user rule are written
  with explicit `IS NULL` / `IS NOT NULL` guards so partial values are rejected.

## Implementation And Decisions

- `012_canonical_rbac_platform.sql` adds enums `approval_state`
  (`pending`/`approved`/`rejected`/`executed`/`stale`/`expired`) and `actor_type`
  (`public`/`user`/`admin`/`system`/`provider`), and 9 tables:
  - `roles` (snake_case `code` unique; positive `version`), `permissions`
    (`domain.action` code unique), `role_permissions` and `user_roles` (grant
    history PK on `granted_at`; partial-unique one active grant per pair; all-or-
    nothing revoke group; `ON DELETE RESTRICT` FKs; active-by-user index).
  - `approval_actions` (closed 8-code `action_type` set; positive
    target/version; jsonb object payload; 32-byte `payload_hash`; maker_reason
    10-1000 chars; checker<>maker; `expires_at > created_at`; partial-unique live
    action per `(action_type,target_type,target_id,target_version)` while
    pending/approved; queue index over the live states).
  - `audit_events` (non-blank command/entity_type; positive version; jsonb object
    metadata; actor_user required for user/admin; bounded control-free
    user_agent; entity/actor/request indexes).
  - `idempotency_records` (unique `(actor_scope,http_method,route_template,key)`;
    32-byte request_hash; uppercase mutation method; 100-599 status; jsonb object
    body; completion>=creation; expiry>completion; expiry cleanup index).
  - `rate_limit_windows` (PK `(bucket,key_hash,window_start)`; 32-byte key_hash;
    positive count; `expires_at > window_start`; cleanup index).
  - `legal_holds` (12-entry entity_type allowlist; reason 10-2000 chars; expiry
    after placement; all-or-nothing release group; release>=placement; partial-
    unique one unreleased hold per entity; active index).
- Decisions/deferrals: append-only enforcement triggers and app-role grant/revoke
  hardening are a later step; the DB here enforces structural invariants. The
  precise approval state-timestamp coherence machine is command-enforced.
  Outbox/email -> BE-007e; repositories -> BE-007f; bootstrap seed -> BE-007g.

## GREEN Validation

| Gate | Command | Result |
|---|---|---|
| Unit check | `npm run check` | green (typecheck + lint + coverage >=80% + build + smoke) |
| Integration | `npm run test:integration` | 12/12 vs PostgreSQL 16 |

## Reviews

- Code + security (focused inline review): snake_case role codes, single active
  role-permission grant, closed maker-checker action set with maker<>checker,
  idempotency scope uniqueness, positive rate-limit counts, and the legal-hold
  allowlist + one-unreleased-per-entity are all verified by integration
  assertions; NULL-safe guards on the all-or-nothing groups close real gaps.
  Additive; no CRITICAL/HIGH/MEDIUM.

## Metrics

- Schema SQL added: `012_canonical_rbac_platform.sql` (9 tables, 2 enums).
- Test TS added: 1 integration test (suite 11 -> 12).
- Production JS/JSX deleted: 0 (additive). Backend authored JS backlog unchanged
  at 83 files.

## Risk, Rollback, And Resume

- Residual risk: outbox/email/repositories not yet present; schema not consumed
  by a route yet; legacy collision documented (canonical isolated at `>= 009`).
- Rollback shape: revert the BE-007d commit; remove `012`.
- Commit/push: conventional commit on `ts-migration/backend`; PR #1 updated.
- Exact next action: BE-007e — `outbox_events` + email delivery/provider-event
  tables (spec `03` §3.3).
